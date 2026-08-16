import { z } from "zod"
import { invalidRequest } from "../../lib/validation"
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
    await requireWorkspaceForUser(params.workspaceId, user.id)

    try {
      return await getWorkspaceAnalytics({
        workspaceId: params.workspaceId,
        range: query.range,
        repositoryIds: query.repositoryIds,
        authorIds: query.authorIds,
      })
    } catch (error) {
      if (error instanceof AnalyticsError) {
        return status(error.statusCode, { error: error.message })
      }

      throw error
    }
  },
  {
    query: analyticsQuerySchema,
    error: invalidRequest("Invalid analytics query"),
  }
)
