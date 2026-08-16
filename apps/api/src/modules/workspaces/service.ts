import { randomUUID } from "node:crypto"
import { and, eq, isNull, notInArray, sql } from "drizzle-orm"
import { db } from "../../db/client"
import {
  repository,
  user,
  workspace,
  workspaceMember,
  type workspaceMemberRole,
} from "../../db/schema"
import { jobs } from "../../jobs/definitions"
import type { GitHubInstallation, GitHubRepository } from "../github/service"
import { defaultWorkspaceReviewConfig } from "../reviews/review-config"

type WorkspaceMemberRole = (typeof workspaceMemberRole.enumValues)[number]

const normalizeAccountType = (type: string): "user" | "organization" =>
  type.toLowerCase() === "organization" ? "organization" : "user"

export class PersonalGitHubWorkspaceAlreadyConnectedError extends Error {
  constructor() {
    super("This personal GitHub account is already connected")
    this.name = "PersonalGitHubWorkspaceAlreadyConnectedError"
  }
}

export const getWorkspaceForUser = async (
  workspaceId: string,
  userId: string
) => {
  const rows = await db
    .select({
      workspace,
      role: workspaceMember.role,
    })
    .from(workspaceMember)
    .innerJoin(workspace, eq(workspace.id, workspaceMember.workspaceId))
    .where(
      and(
        eq(workspaceMember.workspaceId, workspaceId),
        eq(workspaceMember.userId, userId),
        eq(workspaceMember.status, "active")
      )
    )
    .limit(1)

  return rows[0] ?? null
}

export const getWorkspaceForUserWithRole = async (
  workspaceId: string,
  userId: string,
  roles: WorkspaceMemberRole[]
) => {
  const workspaceWithRole = await getWorkspaceForUser(workspaceId, userId)
  return workspaceWithRole && roles.includes(workspaceWithRole.role)
    ? workspaceWithRole
    : null
}

export const getWorkspaceMembershipForUser = async (
  workspaceId: string,
  userId: string
) => {
  return db.query.workspaceMember.findFirst({
    where: and(
      eq(workspaceMember.workspaceId, workspaceId),
      eq(workspaceMember.userId, userId)
    ),
    with: {
      workspace: true,
    },
  })
}

export const inviteWorkspaceMemberByEmail = async ({
  workspaceId,
  email,
  role,
  invitedByUserId,
}: {
  workspaceId: string
  email: string
  role: Exclude<WorkspaceMemberRole, "owner">
  invitedByUserId: string
}) => {
  const normalizedEmail = email.trim().toLowerCase()
  const invitedUser = await db.query.user.findFirst({
    where: sql`lower(${user.email}) = ${normalizedEmail}`,
  })

  if (!invitedUser || !invitedUser.emailVerified) {
    return null
  }

  const existingMembership = await db.query.workspaceMember.findFirst({
    where: and(
      eq(workspaceMember.workspaceId, workspaceId),
      eq(workspaceMember.userId, invitedUser.id)
    ),
  })

  if (existingMembership?.status === "active") {
    return {
      status: "already_member" as const,
      membership: existingMembership,
    }
  }

  const now = new Date()
  const membership = {
    id: existingMembership?.id ?? randomUUID(),
    workspaceId,
    userId: invitedUser.id,
    role,
    status: "pending" as const,
    invitedByUserId,
    invitedAt: now,
    acceptedAt: null,
    updatedAt: now,
  }

  const [savedMembership] = await db
    .insert(workspaceMember)
    .values(membership)
    .onConflictDoUpdate({
      target: [workspaceMember.workspaceId, workspaceMember.userId],
      set: {
        role: membership.role,
        status: membership.status,
        invitedByUserId: membership.invitedByUserId,
        invitedAt: membership.invitedAt,
        acceptedAt: membership.acceptedAt,
        updatedAt: membership.updatedAt,
      },
    })
    .returning()

  return savedMembership
    ? {
        status: "invited" as const,
        membership: savedMembership,
      }
    : null
}

export const upsertGitHubWorkspace = async (
  installation: GitHubInstallation,
  userId: string,
  options: { initialReviewCredits?: number } = {}
) => {
  if (!installation.account) {
    throw new Error("GitHub installation does not include an account")
  }
  const account = installation.account

  const providerInstallationId = String(installation.id)
  const providerAccountId = String(account.id)
  const providerAccountType = normalizeAccountType(account.type)
  const connectionStatus: "active" | "suspended" = installation.suspended_at
    ? "suspended"
    : "active"

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`github:${providerAccountId}`}))`
    )

    const existing = await tx.query.workspace.findFirst({
      where: and(
        eq(workspace.provider, "github"),
        eq(workspace.providerAccountId, providerAccountId)
      ),
    })

    const existingMembership = existing
      ? await tx.query.workspaceMember.findFirst({
          where: and(
            eq(workspaceMember.workspaceId, existing.id),
            eq(workspaceMember.userId, userId)
          ),
        })
      : null
    const hasActiveMembership = existingMembership?.status === "active"

    if (
      existing &&
      providerAccountType === "user" &&
      !hasActiveMembership &&
      existing.installedByUserId !== userId
    ) {
      throw new PersonalGitHubWorkspaceAlreadyConnectedError()
    }

    const workspaceId = existing?.id ?? randomUUID()
    const now = new Date()
    const syncedWorkspace = {
      providerInstallationId,
      providerAccountId,
      providerAccountLogin: account.login,
      providerAccountType,
      providerAccountAvatarUrl: account.avatar_url ?? null,
      name: account.login,
      repositorySelection: installation.repository_selection,
      permissions: installation.permissions,
      connectionStatus,
      updatedAt: now,
    }
    const values = {
      ...defaultWorkspaceReviewConfig,
      ...syncedWorkspace,
      id: workspaceId,
      provider: "github" as const,
      installedByUserId: userId,
      installedAt: now,
      includedCreditBalance: options.initialReviewCredits ?? 0,
      purchasedCreditBalance: 0,
    }

    const [savedWorkspace] = await tx
      .insert(workspace)
      .values(values)
      .onConflictDoUpdate({
        target: [workspace.provider, workspace.providerAccountId],
        set: syncedWorkspace,
      })
      .returning()

    const role: WorkspaceMemberRole =
      existingMembership?.role ??
      (!existing || existing.installedByUserId === userId ? "owner" : "member")
    const membershipStatus =
      existingMembership?.status ?? ("active" as const)
    const acceptedAt =
      membershipStatus === "active"
        ? (existingMembership?.acceptedAt ?? now)
        : (existingMembership?.acceptedAt ?? null)
    const membership = {
      id: existingMembership?.id ?? randomUUID(),
      workspaceId: savedWorkspace!.id,
      userId,
      role,
      status: membershipStatus,
      invitedByUserId: existingMembership?.invitedByUserId ?? null,
      invitedAt: existingMembership?.invitedAt ?? null,
      acceptedAt,
      updatedAt: now,
    }

    await tx
      .insert(workspaceMember)
      .values(membership)
      .onConflictDoUpdate({
        target: [workspaceMember.workspaceId, workspaceMember.userId],
        set: {
          role: membership.role,
          status: membership.status,
          invitedByUserId: membership.invitedByUserId,
          invitedAt: membership.invitedAt,
          acceptedAt: membership.acceptedAt,
          updatedAt: membership.updatedAt,
        },
      })

    return savedWorkspace!
  })
}

export const syncWorkspaceRepositories = async (
  workspaceId: string,
  repositories: GitHubRepository[],
  repositorySelection?: "all" | "selected"
) => {
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`repository-sync:${workspaceId}`}))`
    )

    const now = new Date()
    const providerRepositoryIds = repositories.map((githubRepository) =>
      String(githubRepository.id)
    )

    for (const githubRepository of repositories) {
      const syncedRepository = {
        name: githubRepository.name,
        fullName: githubRepository.full_name,
        owner: githubRepository.owner.login,
        private: githubRepository.private,
        defaultBranch: githubRepository.default_branch,
        htmlUrl: githubRepository.html_url,
        archived: githubRepository.archived,
        providerAccessRemovedAt: null,
        lastSyncedAt: now,
        updatedAt: now,
      }
      await tx
        .insert(repository)
        .values({
          ...syncedRepository,
          id: randomUUID(),
          workspaceId,
          providerRepositoryId: String(githubRepository.id),
          pullRequestSyncStatus: "pending",
        })
        .onConflictDoUpdate({
          target: [repository.workspaceId, repository.providerRepositoryId],
          set: {
            ...syncedRepository,
            pullRequestSyncStatus: sql<
              "pending" | "queued" | "syncing" | "synced" | "failed"
            >`case
              when ${repository.providerAccessRemovedAt} is not null then 'pending'
              else ${repository.pullRequestSyncStatus}
            end`,
          },
        })
    }

    const staleRepositoriesWhere =
      providerRepositoryIds.length === 0
        ? and(
            eq(repository.workspaceId, workspaceId),
            isNull(repository.providerAccessRemovedAt)
          )
        : and(
            eq(repository.workspaceId, workspaceId),
            notInArray(repository.providerRepositoryId, providerRepositoryIds),
            isNull(repository.providerAccessRemovedAt)
          )

    await tx
      .update(repository)
      .set({
        enabled: false,
        providerAccessRemovedAt: now,
        updatedAt: now,
      })
      .where(staleRepositoriesWhere)

    await tx
      .update(workspace)
      .set({
        ...(repositorySelection ? { repositorySelection } : {}),
        lastSyncedAt: now,
        updatedAt: now,
      })
      .where(eq(workspace.id, workspaceId))
  })

  await queuePendingRepositoryPullRequestSyncs(workspaceId)
}

export const queuePendingRepositoryPullRequestSyncs = async (
  workspaceId: string
) =>
  db.transaction(async (tx) => {
    const queuedRepositories = await tx
      .update(repository)
      .set({
        pullRequestSyncStatus: "queued",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(repository.workspaceId, workspaceId),
          eq(repository.pullRequestSyncStatus, "pending"),
          isNull(repository.providerAccessRemovedAt)
        )
      )
      .returning({ id: repository.id })

    for (const queuedRepository of queuedRepositories) {
      await jobs.syncRepositoryPullRequests.enqueue(tx, {
        repositoryId: queuedRepository.id,
      })
    }

    return queuedRepositories.map((queuedRepository) => queuedRepository.id)
  })

export const queueRepositoryPullRequestSync = async (repositoryId: string) =>
  db.transaction(async (tx) => {
    const [queuedRepository] = await tx
      .update(repository)
      .set({
        pullRequestSyncStatus: "queued",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(repository.id, repositoryId),
          notInArray(repository.pullRequestSyncStatus, ["queued", "syncing"]),
          isNull(repository.providerAccessRemovedAt)
        )
      )
      .returning({ id: repository.id })

    if (!queuedRepository) {
      return false
    }

    await jobs.syncRepositoryPullRequests.enqueue(tx, {
      repositoryId: queuedRepository.id,
    })
    return true
  })
