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

export const requireWorkspaceForUser = async (
  workspaceId: string,
  userId: string
) => {
  const workspaceWithRole = await getWorkspaceForUser(workspaceId, userId)

  if (!workspaceWithRole) {
    throw new Error("Workspace not found")
  }

  return workspaceWithRole
}

export const requireWorkspaceRole = async (
  workspaceId: string,
  userId: string,
  roles: WorkspaceMemberRole[]
) => {
  const workspaceWithRole = await requireWorkspaceForUser(workspaceId, userId)

  if (!roles.includes(workspaceWithRole.role)) {
    throw new Error("Insufficient workspace permissions")
  }

  return workspaceWithRole
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
  userId: string
) => {
  if (!installation.account) {
    throw new Error("GitHub installation does not include an account")
  }

  const providerInstallationId = String(installation.id)
  const providerAccountId = String(installation.account.id)
  const providerAccountType = normalizeAccountType(installation.account.type)
  const connectionStatus: "active" | "suspended" = installation.suspended_at
    ? "suspended"
    : "active"

  const existing = await db.query.workspace.findFirst({
    where: and(
      eq(workspace.provider, "github"),
      eq(workspace.providerAccountId, providerAccountId)
    ),
  })

  const existingMembership = existing
    ? await db.query.workspaceMember.findFirst({
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

  const values = {
    ...defaultWorkspaceReviewConfig,
    id: workspaceId,
    provider: "github" as const,
    providerInstallationId,
    providerAccountId,
    providerAccountLogin: installation.account.login,
    providerAccountType,
    providerAccountAvatarUrl: installation.account.avatar_url ?? null,
    name: installation.account.login,
    repositorySelection: installation.repository_selection,
    permissions: installation.permissions,
    connectionStatus,
    installedByUserId: userId,
    installedAt: new Date(),
    updatedAt: new Date(),
  }

  const [savedWorkspace] = await db
    .insert(workspace)
    .values(values)
    .onConflictDoUpdate({
      target: [workspace.provider, workspace.providerAccountId],
      set: {
        providerInstallationId: values.providerInstallationId,
        providerAccountId: values.providerAccountId,
        providerAccountLogin: values.providerAccountLogin,
        providerAccountType: values.providerAccountType,
        providerAccountAvatarUrl: values.providerAccountAvatarUrl,
        name: values.name,
        repositorySelection: values.repositorySelection,
        permissions: values.permissions,
        connectionStatus: values.connectionStatus,
        updatedAt: values.updatedAt,
      },
    })
    .returning()

  const role: WorkspaceMemberRole =
    existingMembership?.role ??
    (!existing || existing.installedByUserId === userId ? "owner" : "member")
  const membershipStatus = existingMembership?.status ?? ("active" as const)
  const acceptedAt =
    membershipStatus === "active"
      ? (existingMembership?.acceptedAt ?? new Date())
      : (existingMembership?.acceptedAt ?? null)
  const membership = {
    id: randomUUID(),
    workspaceId: savedWorkspace.id,
    userId,
    role,
    status: membershipStatus,
    invitedByUserId: existingMembership?.invitedByUserId ?? null,
    invitedAt: existingMembership?.invitedAt ?? null,
    acceptedAt,
    updatedAt: new Date(),
  }

  await db
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

  return savedWorkspace
}

export const syncWorkspaceRepositories = async (
  workspaceId: string,
  repositories: GitHubRepository[],
  repositorySelection?: "all" | "selected"
) => {
  const now = new Date()
  const providerRepositoryIds = repositories.map((githubRepository) =>
    String(githubRepository.id)
  )

  for (const githubRepository of repositories) {
    await db
      .insert(repository)
      .values({
        id: randomUUID(),
        workspaceId,
        providerRepositoryId: String(githubRepository.id),
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
      })
      .onConflictDoUpdate({
        target: [repository.workspaceId, repository.providerRepositoryId],
        set: {
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
        },
      })
      .returning()
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

  await db
    .update(repository)
    .set({
      enabled: false,
      providerAccessRemovedAt: now,
      updatedAt: now,
    })
    .where(staleRepositoriesWhere)

  await db
    .update(workspace)
    .set({
      ...(repositorySelection ? { repositorySelection } : {}),
      lastSyncedAt: now,
      updatedAt: now,
    })
    .where(eq(workspace.id, workspaceId))
}
