import { z } from "zod"
import { protectedRoute } from "../auth"
import { checkRateLimit } from "../../lib/rate-limit"
import {
  requireWorkspaceForUser,
  requireWorkspaceRole,
} from "../workspaces/service"
import { queryDocsLibrarian } from "./librarian"
import {
  createWorkspaceDocSource,
  deleteWorkspaceDocSource,
  enqueueDocSourceCrawl,
  enqueueWorkspaceDocSourceCrawl,
  listDocSourcesWithState,
  listWorkspaceDocSources,
} from "./service"

const querySchema = z.object({
  library: z.string().min(1).max(200),
  question: z.string().min(1).max(2000),
  workspaceId: z.string().min(1).optional(),
})

const createSourceSchema = z.object({
  name: z.string().min(1).max(80),
  llmsTxtUrl: z.url().max(2000),
})

const createSourceRateLimit = { limit: 10, windowMs: 10 * 60 * 1000 }
const crawlSourceRateLimit = { limit: 6, windowMs: 10 * 60 * 1000 }

export const docsRoutes = protectedRoute("/docs")
  .get("/sources", async () => listDocSourcesWithState())
  .post("/sources/:slug/crawl", async ({ params, status }) => {
    const enqueued = await enqueueDocSourceCrawl(params.slug)
    if (!enqueued) {
      return status(404, { error: "Unknown doc source" })
    }
    return { enqueued: true, slug: params.slug }
  })
  .post("/query", async ({ body, user: currentUser, status }) => {
    const parsed = querySchema.safeParse(body)
    if (!parsed.success) {
      return status(400, { error: "Invalid docs query" })
    }
    if (parsed.data.workspaceId) {
      const membership = await requireWorkspaceForUser(
        parsed.data.workspaceId,
        currentUser.id
      ).catch(() => null)
      if (!membership) {
        return status(404, { error: "Workspace not found" })
      }
    }
    return queryDocsLibrarian(parsed.data)
  })

export const workspaceDocsRoutes = protectedRoute("/workspaces")
  .get(
    "/:workspaceId/docs/sources",
    async ({ params, user: currentUser, status }) => {
      const membership = await requireWorkspaceForUser(
        params.workspaceId,
        currentUser.id
      ).catch(() => null)
      if (!membership) {
        return status(404, { error: "Workspace not found" })
      }
      return listWorkspaceDocSources(params.workspaceId)
    }
  )
  .post(
    "/:workspaceId/docs/sources",
    async ({ body, params, user: currentUser, status }) => {
      const parsed = createSourceSchema.safeParse(body)
      if (!parsed.success) {
        return status(400, { error: "Invalid doc source" })
      }
      const membership = await requireWorkspaceRole(
        params.workspaceId,
        currentUser.id,
        ["owner", "admin"]
      ).catch(() => null)
      if (!membership) {
        return status(404, { error: "Workspace not found" })
      }
      const rateLimit = checkRateLimit({
        key: `docs-source-create:${params.workspaceId}`,
        ...createSourceRateLimit,
      })
      if (!rateLimit.allowed) {
        return status(429, {
          error: "Too many doc source changes",
          retryAfterSeconds: rateLimit.retryAfterSeconds,
        })
      }
      const result = await createWorkspaceDocSource({
        workspaceId: params.workspaceId,
        ...parsed.data,
      })
      if (!result.ok) {
        return status(422, { error: result.error })
      }
      return result.source
    }
  )
  .delete(
    "/:workspaceId/docs/sources/:sourceId",
    async ({ params, user: currentUser, status }) => {
      const membership = await requireWorkspaceRole(
        params.workspaceId,
        currentUser.id,
        ["owner", "admin"]
      ).catch(() => null)
      if (!membership) {
        return status(404, { error: "Workspace not found" })
      }
      const removed = await deleteWorkspaceDocSource({
        workspaceId: params.workspaceId,
        sourceId: params.sourceId,
      })
      if (!removed) {
        return status(404, { error: "Doc source not found" })
      }
      return { deleted: true }
    }
  )
  .post(
    "/:workspaceId/docs/sources/:sourceId/crawl",
    async ({ params, user: currentUser, status }) => {
      const membership = await requireWorkspaceRole(
        params.workspaceId,
        currentUser.id,
        ["owner", "admin"]
      ).catch(() => null)
      if (!membership) {
        return status(404, { error: "Workspace not found" })
      }
      const rateLimit = checkRateLimit({
        key: `docs-source-crawl:${params.workspaceId}`,
        ...crawlSourceRateLimit,
      })
      if (!rateLimit.allowed) {
        return status(429, {
          error: "Too many crawl requests",
          retryAfterSeconds: rateLimit.retryAfterSeconds,
        })
      }
      const enqueued = await enqueueWorkspaceDocSourceCrawl({
        workspaceId: params.workspaceId,
        sourceId: params.sourceId,
      })
      if (!enqueued) {
        return status(404, { error: "Doc source not found" })
      }
      return { enqueued: true }
    }
  )
