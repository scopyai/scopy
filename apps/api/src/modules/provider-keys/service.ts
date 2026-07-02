import { randomUUID } from "node:crypto"
import { and, eq } from "drizzle-orm"
import { db } from "../../db/client"
import { repository, workspace, workspaceProviderKey } from "../../db/schema"
import { decryptSecret, encryptSecret, maskSecret } from "../../lib/secrets"
import type { ReviewBillingMode } from "../reviews/review-config"

export type ProviderKeyProvider = "openrouter" | "gateway"

const BYOK_PROVIDER_PRECEDENCE: ProviderKeyProvider[] = [
  "openrouter",
  "gateway",
]

export class ProviderKeyError extends Error {
  constructor(
    message: string,
    readonly statusCode: 400 | 404 | 409 | 502 = 400
  ) {
    super(message)
    this.name = "ProviderKeyError"
  }
}

export type ReviewCredential =
  | { status: "platform" }
  | { status: "byok"; provider: ProviderKeyProvider; apiKey: string }
  | { status: "missing_key" }

const providerLabels: Record<ProviderKeyProvider, string> = {
  openrouter: "OpenRouter",
  gateway: "Vercel AI Gateway",
}

const requireStoredKey = async (workspaceId: string, target: string) => {
  const keys = await listProviderKeys(workspaceId)
  if (keys.length === 0) {
    throw new ProviderKeyError(
      `Add a provider API key before setting ${target} to bring-your-own-key.`,
      409
    )
  }
}

const validateProviderKey = async (
  provider: ProviderKeyProvider,
  apiKey: string
): Promise<void> => {
  const endpoint =
    provider === "openrouter"
      ? "https://openrouter.ai/api/v1/key"
      : "https://ai-gateway.vercel.sh/v1/models"

  let response: Response
  try {
    response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
  } catch {
    throw new ProviderKeyError(
      `Could not reach ${providerLabels[provider]} to validate the key. Please try again.`,
      502
    )
  }

  if (response.status === 401 || response.status === 403) {
    throw new ProviderKeyError(
      `The ${providerLabels[provider]} key was rejected. Double-check it and try again.`,
      400
    )
  }
  if (!response.ok) {
    throw new ProviderKeyError(
      `Could not validate the ${providerLabels[provider]} key (status ${response.status}). Please try again.`,
      502
    )
  }
}

export type ProviderKeySummary = {
  provider: ProviderKeyProvider
  keyPreview: string
  lastUsedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export const listProviderKeys = async (
  workspaceId: string
): Promise<ProviderKeySummary[]> => {
  const rows = await db
    .select({
      provider: workspaceProviderKey.provider,
      keyPreview: workspaceProviderKey.keyPreview,
      lastUsedAt: workspaceProviderKey.lastUsedAt,
      createdAt: workspaceProviderKey.createdAt,
      updatedAt: workspaceProviderKey.updatedAt,
    })
    .from(workspaceProviderKey)
    .where(eq(workspaceProviderKey.workspaceId, workspaceId))

  return rows
}

export const setProviderKey = async ({
  workspaceId,
  provider,
  apiKey,
  userId,
}: {
  workspaceId: string
  provider: ProviderKeyProvider
  apiKey: string
  userId: string
}): Promise<ProviderKeySummary> => {
  const trimmed = apiKey.trim()
  if (!trimmed) {
    throw new ProviderKeyError("API key is required")
  }

  await validateProviderKey(provider, trimmed)

  const envelope = await encryptSecret(trimmed, { workspaceId, provider })
  const keyPreview = maskSecret(trimmed)
  const now = new Date()

  const [row] = await db
    .insert(workspaceProviderKey)
    .values({
      id: randomUUID(),
      workspaceId,
      provider,
      envelope,
      keyPreview,
      createdByUserId: userId,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [workspaceProviderKey.workspaceId, workspaceProviderKey.provider],
      set: {
        envelope,
        keyPreview,
        createdByUserId: userId,
        lastUsedAt: null,
        updatedAt: now,
      },
    })
    .returning({
      provider: workspaceProviderKey.provider,
      keyPreview: workspaceProviderKey.keyPreview,
      lastUsedAt: workspaceProviderKey.lastUsedAt,
      createdAt: workspaceProviderKey.createdAt,
      updatedAt: workspaceProviderKey.updatedAt,
    })

  return row!
}

export const deleteProviderKey = async ({
  workspaceId,
  provider,
}: {
  workspaceId: string
  provider: ProviderKeyProvider
}): Promise<boolean> => {
  const deleted = await db
    .delete(workspaceProviderKey)
    .where(
      and(
        eq(workspaceProviderKey.workspaceId, workspaceId),
        eq(workspaceProviderKey.provider, provider)
      )
    )
    .returning({ id: workspaceProviderKey.id })

  return deleted.length > 0
}

export const resolveReviewCredential = async ({
  workspaceId,
  billingMode,
  preferredProvider = null,
}: {
  workspaceId: string
  billingMode: ReviewBillingMode
  preferredProvider?: ProviderKeyProvider | null
}): Promise<ReviewCredential> => {
  if (billingMode === "platform") return { status: "platform" }

  const rows = await db
    .select()
    .from(workspaceProviderKey)
    .where(eq(workspaceProviderKey.workspaceId, workspaceId))

  const byProvider = new Map(rows.map((row) => [row.provider, row]))
  const chosen =
    (preferredProvider ? byProvider.get(preferredProvider) : undefined) ??
    BYOK_PROVIDER_PRECEDENCE.map((p) => byProvider.get(p)).find(
      (row): row is (typeof rows)[number] => Boolean(row)
    )

  if (!chosen) return { status: "missing_key" }

  const apiKey = await decryptSecret(chosen.envelope, {
    workspaceId,
    provider: chosen.provider,
  })

  await db
    .update(workspaceProviderKey)
    .set({ lastUsedAt: new Date() })
    .where(eq(workspaceProviderKey.id, chosen.id))

  return { status: "byok", provider: chosen.provider, apiKey }
}

export const getWorkspaceBillingSettings = async (
  workspaceId: string
): Promise<{
  billingMode: ReviewBillingMode
  byokProvider: ProviderKeyProvider | null
}> => {
  const row = await db.query.workspace.findFirst({
    where: eq(workspace.id, workspaceId),
    columns: { reviewBillingMode: true, byokProvider: true },
  })
  return {
    billingMode: row?.reviewBillingMode ?? "platform",
    byokProvider: row?.byokProvider ?? null,
  }
}

export const setWorkspaceByokProvider = async ({
  workspaceId,
  provider,
}: {
  workspaceId: string
  provider: ProviderKeyProvider | null
}): Promise<ProviderKeyProvider | null> => {
  const [updated] = await db
    .update(workspace)
    .set({ byokProvider: provider, updatedAt: new Date() })
    .where(eq(workspace.id, workspaceId))
    .returning({ byokProvider: workspace.byokProvider })

  return updated?.byokProvider ?? null
}

export const setRepositoryByokProvider = async ({
  workspaceId,
  repositoryId,
  provider,
}: {
  workspaceId: string
  repositoryId: string
  provider: ProviderKeyProvider | null
}): Promise<ProviderKeyProvider | null> => {
  const updated = await db
    .update(repository)
    .set({ byokProvider: provider, updatedAt: new Date() })
    .where(
      and(
        eq(repository.id, repositoryId),
        eq(repository.workspaceId, workspaceId)
      )
    )
    .returning({ byokProvider: repository.byokProvider })

  if (updated.length === 0) {
    throw new ProviderKeyError("Repository not found", 404)
  }

  return updated[0]!.byokProvider ?? null
}

export const setWorkspaceBillingMode = async ({
  workspaceId,
  billingMode,
}: {
  workspaceId: string
  billingMode: ReviewBillingMode
}): Promise<ReviewBillingMode> => {
  if (billingMode === "byok") {
    await requireStoredKey(workspaceId, "the workspace default")
  }

  const [updated] = await db
    .update(workspace)
    .set({ reviewBillingMode: billingMode, updatedAt: new Date() })
    .where(eq(workspace.id, workspaceId))
    .returning({ reviewBillingMode: workspace.reviewBillingMode })

  return updated?.reviewBillingMode ?? billingMode
}

export type RepositoryBillingModeSetting = ReviewBillingMode | null

export const setRepositoryBillingMode = async ({
  workspaceId,
  repositoryId,
  billingMode,
}: {
  workspaceId: string
  repositoryId: string
  billingMode: RepositoryBillingModeSetting
}): Promise<{ billingMode: RepositoryBillingModeSetting }> => {
  if (billingMode === "byok") {
    await requireStoredKey(workspaceId, "this repository")
  }

  const updated = await db
    .update(repository)
    .set({ reviewBillingMode: billingMode, updatedAt: new Date() })
    .where(
      and(
        eq(repository.id, repositoryId),
        eq(repository.workspaceId, workspaceId)
      )
    )
    .returning({ billingMode: repository.reviewBillingMode })

  if (updated.length === 0) {
    throw new ProviderKeyError("Repository not found", 404)
  }

  return { billingMode: updated[0]!.billingMode }
}
