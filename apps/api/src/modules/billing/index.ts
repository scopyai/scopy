import { z } from "zod"
import { invalidRequest } from "../../lib/validation"
import { protectedRoute } from "../auth"
import {
  BillingError,
  cancelWorkspaceSubscription,
  createWorkspaceCheckout,
  createWorkspaceCreditCheckout,
  createWorkspacePortal,
  getWorkspaceBilling,
  getWorkspaceUsageTrend,
  listWorkspaceCharges,
  listWorkspaceReviewUsage,
  changeWorkspacePlan,
} from "./service"
import { requireWorkspaceForUser } from "../workspaces/service"

const checkoutSchema = z.object({
  tier: z.enum(["premium", "ultra"]),
  requestId: z.uuid(),
})
const creditCheckoutSchema = z.object({
  credits: z.number().int().min(10),
  requestId: z.uuid(),
})
const changePlanSchema = z.object({
  tier: z.enum(["premium", "ultra"]),
})

const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
})

const usageQuerySchema = paginationSchema.extend({
  repositoryId: z.string().optional(),
})

const asBillingError = (error: unknown) => {
  if (error instanceof BillingError) {
    return { statusCode: error.statusCode, error: error.message }
  }

  console.error("Unexpected billing request failure", error)
  return { statusCode: 500 as const, error: "Billing request failed" }
}

export const billingRoutes = protectedRoute("/workspaces")
  .get("/:workspaceId/billing", async ({ params, user }) => {
    await requireWorkspaceForUser(params.workspaceId, user.id)

    return getWorkspaceBilling(params.workspaceId)
  })
  .get(
    "/:workspaceId/billing/usage",
    async ({ params, query, user }) => {
      await requireWorkspaceForUser(params.workspaceId, user.id)

      return listWorkspaceReviewUsage(
        params.workspaceId,
        query.page,
        query.pageSize,
        {
          repositoryId: query.repositoryId,
        }
      )
    },
    {
      query: usageQuerySchema,
      error: invalidRequest("Invalid usage query parameters"),
    }
  )
  .get("/:workspaceId/billing/usage/trend", async ({ params, user }) => {
    await requireWorkspaceForUser(params.workspaceId, user.id)

    return getWorkspaceUsageTrend(params.workspaceId)
  })
  .get(
    "/:workspaceId/billing/charges",
    async ({ params, query, user }) => {
      await requireWorkspaceForUser(params.workspaceId, user.id)

      return listWorkspaceCharges(
        params.workspaceId,
        query.page,
        query.pageSize
      )
    },
    {
      query: paginationSchema,
      error: invalidRequest("Invalid pagination parameters"),
    }
  )
  .post(
    "/:workspaceId/billing/checkout",
    async ({ body, params, user, status }) => {
      await requireWorkspaceForUser(params.workspaceId, user.id, ["owner"])

      try {
        return await createWorkspaceCheckout(
          params.workspaceId,
          user.email,
          body.tier,
          body.requestId
        )
      } catch (error) {
        const billingError = asBillingError(error)
        return status(billingError.statusCode, { error: billingError.error })
      }
    },
    {
      body: checkoutSchema,
      error: invalidRequest("Invalid checkout request"),
    }
  )
  .post(
    "/:workspaceId/billing/credits/checkout",
    async ({ body, params, user, status }) => {
      await requireWorkspaceForUser(params.workspaceId, user.id, ["owner"])

      try {
        return await createWorkspaceCreditCheckout(
          params.workspaceId,
          user.email,
          body.credits,
          body.requestId
        )
      } catch (error) {
        const billingError = asBillingError(error)
        return status(billingError.statusCode, { error: billingError.error })
      }
    },
    {
      body: creditCheckoutSchema,
      error: invalidRequest("Invalid credit checkout request"),
    }
  )
  .post("/:workspaceId/billing/portal", async ({ params, user, status }) => {
    await requireWorkspaceForUser(params.workspaceId, user.id, ["owner"])

    try {
      return await createWorkspacePortal(params.workspaceId)
    } catch (error) {
      const billingError = asBillingError(error)
      return status(billingError.statusCode, { error: billingError.error })
    }
  })
  .post("/:workspaceId/billing/cancel", async ({ params, user, status }) => {
    await requireWorkspaceForUser(params.workspaceId, user.id, ["owner"])

    try {
      return await cancelWorkspaceSubscription(params.workspaceId)
    } catch (error) {
      const billingError = asBillingError(error)
      return status(billingError.statusCode, { error: billingError.error })
    }
  })
  .post(
    "/:workspaceId/billing/change-plan",
    async ({ body, params, user, status }) => {
      await requireWorkspaceForUser(params.workspaceId, user.id, ["owner"])

      try {
        return await changeWorkspacePlan(params.workspaceId, body.tier)
      } catch (error) {
        const billingError = asBillingError(error)
        return status(billingError.statusCode, { error: billingError.error })
      }
    },
    {
      body: changePlanSchema,
      error: invalidRequest("Invalid billing plan change"),
    }
  )
