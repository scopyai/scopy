import { z } from "zod"
import { protectedRoute } from "../auth"
import {
  requireWorkspaceForUser,
  requireWorkspaceRole,
} from "../workspaces/service"
import {
  ProviderKeyError,
  deleteProviderKey,
  getWorkspaceBillingSettings,
  listProviderKeys,
  setProviderKey,
  setRepositoryBillingMode,
  setRepositoryByokProvider,
  setWorkspaceBillingMode,
  setWorkspaceByokProvider,
} from "./service"

const providerSchema = z.enum(["openrouter", "gateway"])
const setKeySchema = z.object({ apiKey: z.string().min(1).max(500) })
const billingModeSchema = z.object({
  billingMode: z.enum(["platform", "byok"]),
})
const repositoryBillingModeSchema = z.object({
  billingMode: z.enum(["platform", "byok"]).nullable(),
})
const byokProviderSchema = z.object({
  provider: z.enum(["openrouter", "gateway"]).nullable(),
})

const asProviderKeyError = (error: unknown) =>
  error instanceof ProviderKeyError
    ? { statusCode: error.statusCode, error: error.message }
    : { statusCode: 500 as const, error: "Provider key request failed" }

const requireMember = (workspaceId: string, userId: string) =>
  requireWorkspaceForUser(workspaceId, userId).catch(() => null)

const requireManager = (workspaceId: string, userId: string) =>
  requireWorkspaceRole(workspaceId, userId, ["owner", "admin"]).catch(
    () => null
  )

export const providerKeyRoutes = protectedRoute("/workspaces")
  .get("/:workspaceId/provider-keys", async ({ params, user, status }) => {
    if (!(await requireMember(params.workspaceId, user.id))) {
      return status(404, { error: "Workspace not found" })
    }

    const [keys, settings] = await Promise.all([
      listProviderKeys(params.workspaceId),
      getWorkspaceBillingSettings(params.workspaceId),
    ])

    return {
      billingMode: settings.billingMode,
      byokProvider: settings.byokProvider,
      keys,
    }
  })
  .put(
    "/:workspaceId/provider-keys/:provider",
    async ({ body, params, user, status }) => {
      if (!(await requireManager(params.workspaceId, user.id))) {
        return status(404, { error: "Workspace not found" })
      }

      const provider = providerSchema.safeParse(params.provider)
      if (!provider.success) {
        return status(400, { error: "Unknown provider" })
      }

      const parsed = setKeySchema.safeParse(body)
      if (!parsed.success) {
        return status(400, { error: "Invalid API key" })
      }

      try {
        return await setProviderKey({
          workspaceId: params.workspaceId,
          provider: provider.data,
          apiKey: parsed.data.apiKey,
          userId: user.id,
        })
      } catch (error) {
        const providerError = asProviderKeyError(error)
        return status(providerError.statusCode, { error: providerError.error })
      }
    }
  )
  .delete(
    "/:workspaceId/provider-keys/:provider",
    async ({ params, user, status }) => {
      if (!(await requireManager(params.workspaceId, user.id))) {
        return status(404, { error: "Workspace not found" })
      }

      const provider = providerSchema.safeParse(params.provider)
      if (!provider.success) {
        return status(400, { error: "Unknown provider" })
      }

      const deleted = await deleteProviderKey({
        workspaceId: params.workspaceId,
        provider: provider.data,
      })

      if (!deleted) {
        return status(404, { error: "Provider key not found" })
      }

      return { deleted: true }
    }
  )
  .patch(
    "/:workspaceId/billing-mode",
    async ({ body, params, user, status }) => {
      if (!(await requireManager(params.workspaceId, user.id))) {
        return status(404, { error: "Workspace not found" })
      }

      const parsed = billingModeSchema.safeParse(body)
      if (!parsed.success) {
        return status(400, { error: "Invalid billing mode" })
      }

      try {
        const billingMode = await setWorkspaceBillingMode({
          workspaceId: params.workspaceId,
          billingMode: parsed.data.billingMode,
        })
        return { billingMode }
      } catch (error) {
        const providerError = asProviderKeyError(error)
        return status(providerError.statusCode, { error: providerError.error })
      }
    }
  )
  .patch(
    "/:workspaceId/byok-provider",
    async ({ body, params, user, status }) => {
      if (!(await requireManager(params.workspaceId, user.id))) {
        return status(404, { error: "Workspace not found" })
      }

      const parsed = byokProviderSchema.safeParse(body)
      if (!parsed.success) {
        return status(400, { error: "Invalid provider selection" })
      }

      const byokProvider = await setWorkspaceByokProvider({
        workspaceId: params.workspaceId,
        provider: parsed.data.provider,
      })
      return { byokProvider }
    }
  )
  .patch(
    "/:workspaceId/repositories/:repositoryId/byok-provider",
    async ({ body, params, user, status }) => {
      if (!(await requireManager(params.workspaceId, user.id))) {
        return status(404, { error: "Workspace not found" })
      }

      const parsed = byokProviderSchema.safeParse(body)
      if (!parsed.success) {
        return status(400, { error: "Invalid provider selection" })
      }

      try {
        const byokProvider = await setRepositoryByokProvider({
          workspaceId: params.workspaceId,
          repositoryId: params.repositoryId,
          provider: parsed.data.provider,
        })
        return { byokProvider }
      } catch (error) {
        const providerError = asProviderKeyError(error)
        return status(providerError.statusCode, { error: providerError.error })
      }
    }
  )
  .patch(
    "/:workspaceId/repositories/:repositoryId/billing-mode",
    async ({ body, params, user, status }) => {
      if (!(await requireManager(params.workspaceId, user.id))) {
        return status(404, { error: "Workspace not found" })
      }

      const parsed = repositoryBillingModeSchema.safeParse(body)
      if (!parsed.success) {
        return status(400, { error: "Invalid billing mode" })
      }

      try {
        return await setRepositoryBillingMode({
          workspaceId: params.workspaceId,
          repositoryId: params.repositoryId,
          billingMode: parsed.data.billingMode,
        })
      } catch (error) {
        const providerError = asProviderKeyError(error)
        return status(providerError.statusCode, { error: providerError.error })
      }
    }
  )
