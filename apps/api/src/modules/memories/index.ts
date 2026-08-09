import { and, desc, eq, inArray } from "drizzle-orm"
import { z } from "zod"
import { db } from "../../db/client"
import { repository, reviewMemory } from "../../db/schema"
import { protectedRoute } from "../auth"
import {
  getWorkspaceForUser,
  getWorkspaceForUserWithRole,
} from "../workspaces/service"

const listMemoriesSchema = z.object({
  repositoryId: z.string().min(1).optional(),
})

const updateMemorySchema = z.object({
  content: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
})

export const memoryRoutes = protectedRoute("/workspaces")
  .get("/:workspaceId/memories", async ({ params, query, user, status }) => {
    const parsed = listMemoriesSchema.safeParse(query)
    if (!parsed.success) {
      return status(400, { error: "Invalid memory query" })
    }

    const workspaceWithRole = await getWorkspaceForUser(
      params.workspaceId,
      user.id
    )
    if (!workspaceWithRole) {
      return status(404, { error: "Workspace not found" })
    }

    return db
      .select({
        id: reviewMemory.id,
        content: reviewMemory.content,
        pathGlob: reviewMemory.pathGlob,
        enabled: reviewMemory.enabled,
        sourceCommentUrl: reviewMemory.sourceCommentUrl,
        createdAt: reviewMemory.createdAt,
        repository: { id: repository.id, fullName: repository.fullName },
      })
      .from(reviewMemory)
      .innerJoin(repository, eq(reviewMemory.repositoryId, repository.id))
      .where(
        parsed.data.repositoryId
          ? and(
              eq(repository.workspaceId, params.workspaceId),
              eq(repository.id, parsed.data.repositoryId)
            )
          : eq(repository.workspaceId, params.workspaceId)
      )
      .orderBy(desc(reviewMemory.createdAt))
  })
  .patch(
    "/:workspaceId/memories/:memoryId",
    async ({ body, params, user, status }) => {
      const parsed = updateMemorySchema.safeParse(body)
      if (!parsed.success) {
        return status(400, { error: "Invalid memory update" })
      }

      const workspaceWithRole = await getWorkspaceForUserWithRole(
        params.workspaceId,
        user.id,
        ["owner", "admin"]
      )
      if (!workspaceWithRole) {
        return status(404, { error: "Workspace not found" })
      }

      const [updated] = await db
        .update(reviewMemory)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(
          and(
            eq(reviewMemory.id, params.memoryId),
            inArray(
              reviewMemory.repositoryId,
              db
                .select({ id: repository.id })
                .from(repository)
                .where(eq(repository.workspaceId, params.workspaceId))
            )
          )
        )
        .returning()

      if (!updated) {
        return status(404, { error: "Memory not found" })
      }
      return updated
    }
  )
  .delete(
    "/:workspaceId/memories/:memoryId",
    async ({ params, user, status }) => {
      const workspaceWithRole = await getWorkspaceForUserWithRole(
        params.workspaceId,
        user.id,
        ["owner", "admin"]
      )
      if (!workspaceWithRole) {
        return status(404, { error: "Workspace not found" })
      }

      const [deleted] = await db
        .delete(reviewMemory)
        .where(
          and(
            eq(reviewMemory.id, params.memoryId),
            inArray(
              reviewMemory.repositoryId,
              db
                .select({ id: repository.id })
                .from(repository)
                .where(eq(repository.workspaceId, params.workspaceId))
            )
          )
        )
        .returning()

      if (!deleted) {
        return status(404, { error: "Memory not found" })
      }
      return { success: true }
    }
  )
