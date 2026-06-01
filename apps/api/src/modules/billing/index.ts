import { z } from "zod";
import { protectedRoute } from "../../app/auth";
import {
  BillingError,
  cancelWorkspaceSubscription,
  createWorkspaceCheckout,
  createWorkspacePortal,
  getWorkspaceBilling,
  listWorkspaceCreditLedger,
  changeWorkspacePlan,
} from "../../services/billing";
import {
  requireWorkspaceForUser,
  requireWorkspaceRole,
} from "../../services/workspaces";

const checkoutSchema = z.object({
  tier: z.enum(["premium", "ultra"]),
  requestId: z.uuid(),
});
const changePlanSchema = z.object({
  tier: z.enum(["premium", "ultra"]),
});

const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

const asBillingError = (error: unknown) =>
  error instanceof BillingError
    ? { statusCode: error.statusCode, error: error.message }
    : { statusCode: 500 as const, error: "Billing request failed" };

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
    "/:workspaceId/billing/credits",
    async ({ params, query, user, status }) => {
      if (!(await requireMember(params.workspaceId, user.id))) {
        return status(404, { error: "Workspace not found" });
      }

      const parsed = paginationSchema.safeParse(query);
      if (!parsed.success) {
        return status(400, { error: "Invalid pagination parameters" });
      }

      return listWorkspaceCreditLedger(
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
