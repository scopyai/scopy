import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../db/client";
import {
  repository,
  reviewConfig,
  workspace,
  workspaceMember,
  type workspaceMemberRole,
} from "../db/schema";
import type {
  GitHubInstallation,
  GitHubRepository,
} from "./github";

type WorkspaceMemberRole = (typeof workspaceMemberRole.enumValues)[number];

const normalizeAccountType = (type: string): "user" | "organization" =>
  type.toLowerCase() === "organization" ? "organization" : "user";

export const getWorkspaceForUser = async (
  workspaceId: string,
  userId: string,
) => {
  const rows = await db
    .select({
      workspace,
      role: workspaceMember.role,
    })
    .from(workspaceMember)
    .innerJoin(workspace, eq(workspace.id, workspaceMember.workspaceId))
    .where(
      and(eq(workspaceMember.workspaceId, workspaceId), eq(workspaceMember.userId, userId)),
    )
    .limit(1);

  return rows[0] ?? null;
};

export const requireWorkspaceForUser = async (
  workspaceId: string,
  userId: string,
) => {
  const workspaceWithRole = await getWorkspaceForUser(workspaceId, userId);

  if (!workspaceWithRole) {
    throw new Error("Workspace not found");
  }

  return workspaceWithRole;
};

export const requireWorkspaceRole = async (
  workspaceId: string,
  userId: string,
  roles: WorkspaceMemberRole[],
) => {
  const workspaceWithRole = await requireWorkspaceForUser(workspaceId, userId);

  if (!roles.includes(workspaceWithRole.role)) {
    throw new Error("Insufficient workspace permissions");
  }

  return workspaceWithRole;
};

export const upsertGitHubWorkspace = async (
  installation: GitHubInstallation,
  userId: string,
) => {
  if (!installation.account) {
    throw new Error("GitHub installation does not include an account");
  }

  const providerInstallationId = String(installation.id);
  const providerAccountId = String(installation.account.id);
  const providerAccountType = normalizeAccountType(installation.account.type);
  const connectionStatus: "active" | "suspended" = installation.suspended_at
    ? "suspended"
    : "active";

  const existing = await db.query.workspace.findFirst({
    where: and(
      eq(workspace.provider, "github"),
      eq(workspace.providerAccountId, providerAccountId),
    ),
  });

  const workspaceId = existing?.id ?? randomUUID();

  const values = {
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
  };

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
        installedByUserId: values.installedByUserId,
        updatedAt: values.updatedAt,
      },
    })
    .returning();

  const membership = {
    id: randomUUID(),
    workspaceId: savedWorkspace.id,
    userId,
    role: "owner" as const,
    updatedAt: new Date(),
  };

  await db
    .insert(workspaceMember)
    .values(membership)
    .onConflictDoUpdate({
      target: [workspaceMember.workspaceId, workspaceMember.userId],
      set: {
        role: membership.role,
        updatedAt: membership.updatedAt,
      },
    });

  return savedWorkspace;
};

export const syncWorkspaceRepositories = async (
  workspaceId: string,
  repositories: GitHubRepository[],
) => {
  const now = new Date();

  for (const githubRepository of repositories) {
    const [savedRepository] = await db
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
          lastSyncedAt: now,
          updatedAt: now,
        },
      })
      .returning();

    await db
      .insert(reviewConfig)
      .values({
        id: randomUUID(),
        repositoryId: savedRepository.id,
      })
      .onConflictDoNothing({
        target: reviewConfig.repositoryId,
      });
  }

  await db
    .update(workspace)
    .set({
      lastSyncedAt: now,
      updatedAt: now,
    })
    .where(eq(workspace.id, workspaceId));
};
