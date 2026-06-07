import { z } from "zod"
import { protectedRoute } from "../auth"
import { requireWorkspaceForUser } from "../workspaces/service"
import {
  AnalyticsError,
  analyticsRangeValues,
  getWorkspaceAnalytics,
} from "./service"

const analyticsQuerySchema = z.object({
  range: z.enum(analyticsRangeValues).default("last_30_days"),
  repositoryIds: z.string().optional(),
  authorIds: z.string().optional(),
})

export const analyticsRoutes = protectedRoute("/workspaces").get(
  "/:workspaceId/analytics",
  async ({ params, query, user, status }) => {
    const workspaceWithRole = await requireWorkspaceForUser(
      params.workspaceId,
      user.id,
    ).catch(() => null)

    if (!workspaceWithRole) {
      return status(404, { error: "Workspace not found" })
    }

    const parsed = analyticsQuerySchema.safeParse(query)
    if (!parsed.success) {
      return status(400, { error: "Invalid analytics query" })
    }

    try {
      return await getWorkspaceAnalytics({
        workspaceId: params.workspaceId,
        range: parsed.data.range,
        repositoryIds: parsed.data.repositoryIds,
        authorIds: parsed.data.authorIds,
      })
    } catch (error) {
      if (error instanceof AnalyticsError) {
        return status(error.statusCode, { error: error.message })
      }

      throw error
    }
  },
)
