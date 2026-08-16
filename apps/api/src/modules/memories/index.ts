import { and, desc, eq, inArray } from "drizzle-orm"
import { z } from "zod"
import { db } from "../../db/client"
import { invalidRequest } from "../../lib/validation"
import { repository, reviewMemory } from "../../db/schema"
import { protectedRoute } from "../auth"
import { requireWorkspaceForUser } from "../workspaces/service"

const listMemoriesSchema = z.object({
  repositoryId: z.string().min(1).optional(),
})

const updateMemorySchema = z
  .object({
    content: z.string().trim().min(1).max(10_000).optional(),
    enabled: z.boolean().optional(),
  })
  .refine((value) => value.content !== undefined || value.enabled !== undefined)

export const memoryRoutes = protectedRoute("/workspaces")
  .get(
    "/:workspaceId/memories",
    async ({ params, query, user }) => {
      await requireWorkspaceForUser(params.workspaceId, user.id)

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
          query.repositoryId
            ? and(
                eq(repository.workspaceId, params.workspaceId),
                eq(repository.id, query.repositoryId)
              )
            : eq(repository.workspaceId, params.workspaceId)
        )
        .orderBy(desc(reviewMemory.createdAt))
    },
    {
      query: listMemoriesSchema,
      error: invalidRequest("Invalid memory query"),
    }
  )
  .patch(
    "/:workspaceId/memories/:memoryId",
    async ({ body, params, user, status }) => {
      await requireWorkspaceForUser(params.workspaceId, user.id, [
        "owner",
        "admin",
      ])

      const [updated] = await db
        .update(reviewMemory)
        .set({ ...body, updatedAt: new Date() })
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
    },
    {
      body: updateMemorySchema,
      error: invalidRequest("Invalid memory update"),
    }
  )
  .delete(
    "/:workspaceId/memories/:memoryId",
    async ({ params, user, status }) => {
      await requireWorkspaceForUser(params.workspaceId, user.id, [
        "owner",
        "admin",
      ])

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
