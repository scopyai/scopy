import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { protectedRoute } from "../../app/auth";
import { db } from "../../db/client";
import {
  repository,
  reviewConfig,
  user,
  workspace,
  workspaceMember,
} from "../../db/schema";
import { listGitHubInstallationRepositories } from "../../services/github";
import {
  requireWorkspaceForUser,
  requireWorkspaceRole,
  syncWorkspaceRepositories,
} from "../../services/workspaces";

const updateWorkspaceSchema = z.object({
  name: z.string().min(1).max(120),
});

const updateRepositorySchema = z.object({
  enabled: z.boolean().optional(),
});

const updateReviewConfigSchema = z.object({
  enabled: z.boolean().optional(),
  reviewPullRequests: z.boolean().optional(),
  reviewDrafts: z.boolean().optional(),
  baseBranchPatterns: z.array(z.string().min(1)).optional(),
  pathIncludePatterns: z.array(z.string().min(1)).optional(),
  pathExcludePatterns: z.array(z.string().min(1)).optional(),
});

export const workspaceRoutes = protectedRoute("/workspaces")
  .get("/", async ({ user: currentUser }) => {
    return db
      .select({
        workspace,
        role: workspaceMember.role,
      })
      .from(workspaceMember)
      .innerJoin(workspace, eq(workspace.id, workspaceMember.workspaceId))
      .where(eq(workspaceMember.userId, currentUser.id))
      .orderBy(asc(workspace.name));
  })
  .get("/:workspaceId", async ({ params, user: currentUser, status }) => {
    const workspaceWithRole = await requireWorkspaceForUser(
      params.workspaceId,
      currentUser.id,
    ).catch(() => null);

    if (!workspaceWithRole) {
      return status(404, { error: "Workspace not found" });
    }

    return workspaceWithRole;
  })
  .patch("/:workspaceId", async ({ body, params, user: currentUser, status }) => {
    const parsed = updateWorkspaceSchema.safeParse(body);

    if (!parsed.success) {
      return status(400, { error: "Invalid workspace update" });
    }

    const workspaceWithRole = await requireWorkspaceRole(
      params.workspaceId,
      currentUser.id,
      ["owner", "admin"],
    ).catch(() => null);

    if (!workspaceWithRole) {
      return status(404, { error: "Workspace not found" });
    }

    const [updatedWorkspace] = await db
      .update(workspace)
      .set({
        name: parsed.data.name,
        updatedAt: new Date(),
      })
      .where(eq(workspace.id, params.workspaceId))
      .returning();

    return updatedWorkspace;
  })
  .delete("/:workspaceId", async ({ params, user: currentUser, status }) => {
    const workspaceWithRole = await requireWorkspaceRole(
      params.workspaceId,
      currentUser.id,
      ["owner"],
    ).catch(() => null);

    if (!workspaceWithRole) {
      return status(404, { error: "Workspace not found" });
    }

    const [updatedWorkspace] = await db
      .update(workspace)
      .set({
        connectionStatus: "deleted",
        updatedAt: new Date(),
      })
      .where(eq(workspace.id, params.workspaceId))
      .returning();

    return updatedWorkspace;
  })
  .get("/:workspaceId/members", async ({ params, user: currentUser, status }) => {
    const workspaceWithRole = await requireWorkspaceForUser(
      params.workspaceId,
      currentUser.id,
    ).catch(() => null);

    if (!workspaceWithRole) {
      return status(404, { error: "Workspace not found" });
    }

    return db
      .select({
        id: workspaceMember.id,
        role: workspaceMember.role,
        createdAt: workspaceMember.createdAt,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
        },
      })
      .from(workspaceMember)
      .innerJoin(user, eq(user.id, workspaceMember.userId))
      .where(eq(workspaceMember.workspaceId, params.workspaceId))
      .orderBy(asc(user.name));
  })
  .post("/:workspaceId/sync", async ({ params, user: currentUser, status }) => {
    const workspaceWithRole = await requireWorkspaceRole(
      params.workspaceId,
      currentUser.id,
      ["owner", "admin"],
    ).catch(() => null);

    if (!workspaceWithRole) {
      return status(404, { error: "Workspace not found" });
    }

    try {
      const repositories = await listGitHubInstallationRepositories(
        workspaceWithRole.workspace.providerInstallationId,
      );

      await syncWorkspaceRepositories(params.workspaceId, repositories);

      return {
        synced: repositories.length,
      };
    } catch {
      return status(502, { error: "Failed to sync GitHub repositories" });
    }
  })
  .get(
    "/:workspaceId/repositories",
    async ({ params, user: currentUser, query, status }) => {
      const workspaceWithRole = await requireWorkspaceForUser(
        params.workspaceId,
        currentUser.id,
      ).catch(() => null);

      if (!workspaceWithRole) {
        return status(404, { error: "Workspace not found" });
      }

      const enabled =
        query.enabled === "true"
          ? true
          : query.enabled === "false"
            ? false
            : undefined;

      const where =
        enabled === undefined
          ? eq(repository.workspaceId, params.workspaceId)
          : and(
              eq(repository.workspaceId, params.workspaceId),
              eq(repository.enabled, enabled),
            );

      return db
        .select()
        .from(repository)
        .where(where)
        .orderBy(asc(repository.fullName));
    },
  )
  .get(
    "/:workspaceId/repositories/:repositoryId",
    async ({ params, user: currentUser, status }) => {
      const workspaceWithRole = await requireWorkspaceForUser(
        params.workspaceId,
        currentUser.id,
      ).catch(() => null);

      if (!workspaceWithRole) {
        return status(404, { error: "Workspace not found" });
      }

      const repo = await db.query.repository.findFirst({
        where: and(
          eq(repository.id, params.repositoryId),
          eq(repository.workspaceId, params.workspaceId),
        ),
        with: {
          reviewConfig: true,
        },
      });

      if (!repo) {
        return status(404, { error: "Repository not found" });
      }

      return repo;
    },
  )
  .patch(
    "/:workspaceId/repositories/:repositoryId",
    async ({ body, params, user: currentUser, status }) => {
      const parsed = updateRepositorySchema.safeParse(body);

      if (!parsed.success) {
        return status(400, { error: "Invalid repository update" });
      }

      const workspaceWithRole = await requireWorkspaceRole(
        params.workspaceId,
        currentUser.id,
        ["owner", "admin"],
      ).catch(() => null);

      if (!workspaceWithRole) {
        return status(404, { error: "Workspace not found" });
      }

      const [updatedRepository] = await db
        .update(repository)
        .set({
          ...parsed.data,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(repository.id, params.repositoryId),
            eq(repository.workspaceId, params.workspaceId),
          ),
        )
        .returning();

      if (!updatedRepository) {
        return status(404, { error: "Repository not found" });
      }

      return updatedRepository;
    },
  )
  .get(
    "/:workspaceId/repositories/:repositoryId/review-config",
    async ({ params, user: currentUser, status }) => {
      const workspaceWithRole = await requireWorkspaceForUser(
        params.workspaceId,
        currentUser.id,
      ).catch(() => null);

      if (!workspaceWithRole) {
        return status(404, { error: "Workspace not found" });
      }

      const repo = await db.query.repository.findFirst({
        where: and(
          eq(repository.id, params.repositoryId),
          eq(repository.workspaceId, params.workspaceId),
        ),
        with: {
          reviewConfig: true,
        },
      });

      if (!repo) {
        return status(404, { error: "Repository not found" });
      }

      return repo.reviewConfig;
    },
  )
  .patch(
    "/:workspaceId/repositories/:repositoryId/review-config",
    async ({ body, params, user: currentUser, status }) => {
      const parsed = updateReviewConfigSchema.safeParse(body);

      if (!parsed.success) {
        return status(400, { error: "Invalid review config update" });
      }

      const workspaceWithRole = await requireWorkspaceRole(
        params.workspaceId,
        currentUser.id,
        ["owner", "admin"],
      ).catch(() => null);

      if (!workspaceWithRole) {
        return status(404, { error: "Workspace not found" });
      }

      const repo = await db.query.repository.findFirst({
        where: and(
          eq(repository.id, params.repositoryId),
          eq(repository.workspaceId, params.workspaceId),
        ),
        with: {
          reviewConfig: true,
        },
      });

      if (!repo) {
        return status(404, { error: "Repository not found" });
      }

      const values = {
        id: repo.reviewConfig?.id ?? randomUUID(),
        repositoryId: repo.id,
        ...parsed.data,
        updatedAt: new Date(),
      };

      const [updatedReviewConfig] = await db
        .insert(reviewConfig)
        .values(values)
        .onConflictDoUpdate({
          target: reviewConfig.repositoryId,
          set: {
            ...parsed.data,
            updatedAt: values.updatedAt,
          },
        })
        .returning();

      return updatedReviewConfig;
    },
  );
