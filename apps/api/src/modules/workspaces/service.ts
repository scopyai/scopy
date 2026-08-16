import { and, eq, isNull, ne, notInArray, sql } from "drizzle-orm"
import { status } from "elysia"
import { db } from "../../db/client"
import {
  pullRequest,
  repository,
  user,
  workspace,
  workspaceMember,
  type workspaceMemberRole,
} from "../../db/schema"
import { jobs } from "../../jobs/definitions"
import {
  listGitHubInstallationRepositories,
  type GitHubInstallation,
  type GitHubRepository,
} from "../github/service"
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

export const requireWorkspaceForUser = async (
  workspaceId: string,
  userId: string,
  roles?: WorkspaceMemberRole[]
) => {
  const workspaceWithRole = roles
    ? await getWorkspaceForUserWithRole(workspaceId, userId, roles)
    : await getWorkspaceForUser(workspaceId, userId)

  if (!workspaceWithRole) {
    throw status(404, { error: "Workspace not found" })
  }

  return workspaceWithRole
}

type WorkspaceAccessOptions = {
  roles?: WorkspaceMemberRole[]
}

export const requireRepositoryForUser = async (
  workspaceId: string,
  repositoryId: string,
  userId: string,
  options: WorkspaceAccessOptions = {}
) => {
  const workspaceWithRole = await requireWorkspaceForUser(
    workspaceId,
    userId,
    options.roles
  )

  const repo = await db.query.repository.findFirst({
    where: and(
      eq(repository.id, repositoryId),
      eq(repository.workspaceId, workspaceId)
    ),
  })

  if (!repo) {
    throw status(404, { error: "Repository not found" })
  }

  return { ...workspaceWithRole, repository: repo }
}

export const requirePullRequestForUser = async (
  workspaceId: string,
  repositoryId: string,
  pullRequestId: string,
  userId: string
) => {
  const repositoryAccess = await requireRepositoryForUser(
    workspaceId,
    repositoryId,
    userId
  )

  if (repositoryAccess.repository.providerAccessRemovedAt) {
    throw status(404, { error: "Pull request not found" })
  }

  const savedPullRequest = await db.query.pullRequest.findFirst({
    where: and(
      eq(pullRequest.id, pullRequestId),
      eq(pullRequest.repositoryId, repositoryId)
    ),
  })

  if (!savedPullRequest) {
    throw status(404, { error: "Pull request not found" })
  }

  return { ...repositoryAccess, pullRequest: savedPullRequest }
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
  const providerAccountType =
    "type" in account ? normalizeAccountType(account.type) : "organization"
  const providerAccountLogin = "login" in account ? account.login : account.slug
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

    const now = new Date()
    const syncedWorkspace = {
      providerInstallationId,
      providerAccountId,
      providerAccountLogin,
      providerAccountType,
      providerAccountAvatarUrl: account.avatar_url ?? null,
      name: providerAccountLogin,
      repositorySelection: installation.repository_selection,
      permissions: installation.permissions,
      connectionStatus,
      updatedAt: now,
    }
    const values = {
      ...defaultWorkspaceReviewConfig,
      ...syncedWorkspace,
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
    const membershipStatus = existingMembership?.status ?? ("active" as const)
    const acceptedAt =
      membershipStatus === "active"
        ? (existingMembership?.acceptedAt ?? now)
        : (existingMembership?.acceptedAt ?? null)
    const membership = {
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
        updatedAt: now,
      }
      await tx
        .insert(repository)
        .values({
          ...syncedRepository,
          workspaceId,
          providerRepositoryId: String(githubRepository.id),
          pullRequestSyncStatus: "pending",
        })
        .onConflictDoUpdate({
          target: [repository.workspaceId, repository.providerRepositoryId],
          set: {
            ...syncedRepository,
            pullRequestSyncStatus: sql<
              "pending" | "syncing" | "synced" | "failed"
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
        providerAccessRemovedAt: now,
        updatedAt: now,
      })
      .where(staleRepositoriesWhere)

    await tx
      .update(workspace)
      .set({
        ...(repositorySelection ? { repositorySelection } : {}),
        updatedAt: now,
      })
      .where(eq(workspace.id, workspaceId))
  })

  await submitPendingRepositoryPullRequestSyncs(workspaceId)
}

export const syncGitHubWorkspaceRepositories = async (
  workspaceId: string,
  installationId: string,
  repositorySelection?: "all" | "selected"
) => {
  const repositories = await listGitHubInstallationRepositories(installationId)

  await syncWorkspaceRepositories(
    workspaceId,
    repositories,
    repositorySelection
  )

  return repositories.length
}

export const submitPendingRepositoryPullRequestSyncs = async (
  workspaceId: string
) => {
  const pendingRepositories = await db
    .select({ id: repository.id })
    .from(repository)
    .where(
      and(
        eq(repository.workspaceId, workspaceId),
        eq(repository.pullRequestSyncStatus, "pending"),
        isNull(repository.providerAccessRemovedAt)
      )
    )

  const submissions = await Promise.allSettled(
    pendingRepositories.map(({ id: repositoryId }) =>
      jobs.syncRepositoryPullRequests.enqueue({ repositoryId })
    )
  )
  const failures = submissions.flatMap((submission) =>
    submission.status === "rejected" ? [submission.reason] : []
  )
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      "Failed to submit repository pull request synchronization"
    )
  }

  return pendingRepositories.map(({ id }) => id)
}

export const submitRepositoryPullRequestSync = async (repositoryId: string) => {
  const [pendingRepository] = await db
    .update(repository)
    .set({
      pullRequestSyncStatus: "pending",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(repository.id, repositoryId),
        ne(repository.pullRequestSyncStatus, "syncing"),
        isNull(repository.providerAccessRemovedAt)
      )
    )
    .returning({ id: repository.id })

  if (!pendingRepository) return false

  await jobs.syncRepositoryPullRequests.enqueue({
    repositoryId: pendingRepository.id,
  })
  return true
}
