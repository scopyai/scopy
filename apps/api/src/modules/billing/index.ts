import { z } from "zod";
import { protectedRoute } from "../auth";
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
} from "./service";
import {
  requireWorkspaceForUser,
  requireWorkspaceRole,
} from "../workspaces/service";

const checkoutSchema = z.object({
  tier: z.enum(["premium", "ultra"]),
  requestId: z.uuid(),
});
const creditCheckoutSchema = z.object({
  credits: z.number().int().min(10),
  requestId: z.uuid(),
});
const changePlanSchema = z.object({
  tier: z.enum(["premium", "ultra"]),
});

const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

const usageQuerySchema = paginationSchema.extend({
  repositoryId: z.string().optional(),
});

const asBillingError = (error: unknown) => {
  if (error instanceof BillingError) {
    return { statusCode: error.statusCode, error: error.message };
  }

  console.error("Unexpected billing request failure", error);
  return { statusCode: 500 as const, error: "Billing request failed" };
};

const requireMember = (workspaceId: string, userId: string) =>
  requireWorkspaceForUser(workspaceId, userId).catch(() => null);

const requireOwner = (workspaceId: string, userId: string) =>
  requireWorkspaceRole(workspaceId, userId, ["owner"]).catch(() => null);

export const billingRoutes = protectedRoute("/workspaces")
  .get("/:workspaceId/billing", async ({ params, user, status }) => {
    if (!(await requireMember(params.workspaceId, user.id))) {
      return status(404, { error: "Workspace not found" });
    }

    return getWorkspaceBilling(params.workspaceId);
  })
  .get(
    "/:workspaceId/billing/usage",
    async ({ params, query, user, status }) => {
      if (!(await requireMember(params.workspaceId, user.id))) {
        return status(404, { error: "Workspace not found" });
      }

      const parsed = usageQuerySchema.safeParse(query);
      if (!parsed.success) {
        return status(400, { error: "Invalid usage query parameters" });
      }

      return listWorkspaceReviewUsage(
        params.workspaceId,
        parsed.data.page,
        parsed.data.pageSize,
        {
          repositoryId: parsed.data.repositoryId,
        },
      );
    },
  )
  .get(
    "/:workspaceId/billing/usage/trend",
    async ({ params, user, status }) => {
      if (!(await requireMember(params.workspaceId, user.id))) {
        return status(404, { error: "Workspace not found" });
      }

      return getWorkspaceUsageTrend(params.workspaceId);
    },
  )
  .get(
    "/:workspaceId/billing/charges",
    async ({ params, query, user, status }) => {
      if (!(await requireMember(params.workspaceId, user.id))) {
        return status(404, { error: "Workspace not found" });
      }

      const parsed = paginationSchema.safeParse(query);
      if (!parsed.success) {
        return status(400, { error: "Invalid pagination parameters" });
      }

      return listWorkspaceCharges(
        params.workspaceId,
        parsed.data.page,
        parsed.data.pageSize,
      );
    },
  )
  .post(
    "/:workspaceId/billing/checkout",
    async ({ body, params, user, status }) => {
      if (!(await requireOwner(params.workspaceId, user.id))) {
        return status(404, { error: "Workspace not found" });
      }

      const parsed = checkoutSchema.safeParse(body);
      if (!parsed.success) {
        return status(400, { error: "Invalid checkout request" });
      }

      try {
        return await createWorkspaceCheckout(
          params.workspaceId,
          user.email,
          parsed.data.tier,
          parsed.data.requestId,
        );
      } catch (error) {
        const billingError = asBillingError(error);
        return status(billingError.statusCode, { error: billingError.error });
      }
    },
  )
  .post(
    "/:workspaceId/billing/credits/checkout",
    async ({ body, params, user, status }) => {
      if (!(await requireOwner(params.workspaceId, user.id))) {
        return status(404, { error: "Workspace not found" });
      }

      const parsed = creditCheckoutSchema.safeParse(body);
      if (!parsed.success) {
        return status(400, { error: "Invalid credit checkout request" });
      }

      try {
        return await createWorkspaceCreditCheckout(
          params.workspaceId,
          user.email,
          parsed.data.credits,
          parsed.data.requestId,
        );
      } catch (error) {
        const billingError = asBillingError(error);
        return status(billingError.statusCode, { error: billingError.error });
      }
    },
  )
  .post("/:workspaceId/billing/portal", async ({ params, user, status }) => {
    if (!(await requireOwner(params.workspaceId, user.id))) {
      return status(404, { error: "Workspace not found" });
    }

    try {
      return await createWorkspacePortal(params.workspaceId);
    } catch (error) {
      const billingError = asBillingError(error);
      return status(billingError.statusCode, { error: billingError.error });
    }
  })
  .post("/:workspaceId/billing/cancel", async ({ params, user, status }) => {
    if (!(await requireOwner(params.workspaceId, user.id))) {
      return status(404, { error: "Workspace not found" });
    }

    try {
      return await cancelWorkspaceSubscription(params.workspaceId);
    } catch (error) {
      const billingError = asBillingError(error);
      return status(billingError.statusCode, { error: billingError.error });
    }
  })
  .post("/:workspaceId/billing/change-plan", async ({ body, params, user, status }) => {
    if (!(await requireOwner(params.workspaceId, user.id))) {
      return status(404, { error: "Workspace not found" });
    }

    const parsed = changePlanSchema.safeParse(body);
    if (!parsed.success) {
      return status(400, { error: "Invalid billing plan change" });
    }

    try {
      return await changeWorkspacePlan(params.workspaceId, parsed.data.tier);
    } catch (error) {
      const billingError = asBillingError(error);
      return status(billingError.statusCode, { error: billingError.error });
    }
  });
