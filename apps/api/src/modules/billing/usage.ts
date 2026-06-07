import { randomUUID } from "node:crypto"
import { eq, sql } from "drizzle-orm"
import { db } from "../../db/client"
import { workspace, workspaceCreditTransaction } from "../../db/schema"
import { env } from "../../env"

export const MICROCENTS_PER_USD = 1_000_000
const BYTES_PER_GIB = 1024 ** 3
const BYTES_PER_TIB = 1024 ** 4

const ceilDiv = (numerator: bigint, denominator: bigint) =>
  (numerator + denominator - 1n) / denominator

export const usdToMicrocents = (usd: number) => {
  if (!Number.isFinite(usd) || usd < 0) return null
  return Math.ceil(usd * MICROCENTS_PER_USD)
}

export const calculateVectorWriteCostMicrocents = (bytes: number) =>
  Number(
    ceilDiv(
      BigInt(Math.max(0, Math.ceil(bytes))) *
        BigInt(env.VECTOR_WRITE_MICROUSD_PER_GIB),
      BigInt(BYTES_PER_GIB),
    ),
  )

export const calculateVectorQueryCostMicrocents = (bytes: number) =>
  Number(
    ceilDiv(
      BigInt(Math.max(0, Math.ceil(bytes))) *
        BigInt(env.VECTOR_QUERY_MICROUSD_PER_TIB),
      BigInt(BYTES_PER_TIB),
    ),
  )

export const calculateVectorNetworkCostMicrocents = (bytes: number) =>
  Number(
    ceilDiv(
      BigInt(Math.max(0, Math.ceil(bytes))) *
        BigInt(env.VECTOR_NETWORK_MICROUSD_PER_GIB),
      BigInt(BYTES_PER_GIB),
    ),
  )

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const numberAt = (value: unknown, path: string[]) => {
  let current = value
  for (const key of path) {
    if (!isRecord(current)) return null
    current = current[key]
  }
  return typeof current === "number" && Number.isFinite(current) ? current : null
}

export const extractOpenRouterCost = (generation: unknown) => {
  const cost =
    numberAt(generation, ["providerMetadata", "openrouter", "usage", "cost"]) ??
    numberAt(generation, ["response", "body", "usage", "cost"])
  const costMicrocents = cost === null ? null : usdToMicrocents(cost)
  return {
    cost,
    costMicrocents,
    providerMetadata: isRecord(generation)
      ? generation.providerMetadata
      : undefined,
    generationId: undefined as string | undefined,
    generationUsage: undefined as unknown,
  }
}

const extractOpenRouterGenerationId = (generation: unknown) => {
  const directId = numberAt(generation, ["response", "id"])
  if (directId !== null) return String(directId)
  const responseId =
    isRecord(generation) &&
    isRecord(generation.response) &&
    typeof generation.response.id === "string"
      ? generation.response.id
      : null
  if (responseId) return responseId
  return isRecord(generation) &&
    isRecord(generation.response) &&
    isRecord(generation.response.body) &&
    typeof generation.response.body.id === "string"
    ? generation.response.body.id
    : null
}

export const resolveOpenRouterCost = async (generation: unknown) => {
  const extracted = extractOpenRouterCost(generation)
  if (extracted.costMicrocents !== null) return extracted

  const generationId = extractOpenRouterGenerationId(generation)
  if (!generationId || !env.OPENROUTER_API_KEY) return extracted

  const response = await fetch(
    `https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(
      generationId,
    )}`,
    {
      headers: {
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
      },
    },
  )
  if (!response.ok) return extracted

  const body = (await response.json()) as unknown
  const cost =
    numberAt(body, ["data", "total_cost"]) ??
    numberAt(body, ["data", "cost"]) ??
    numberAt(body, ["total_cost"]) ??
    numberAt(body, ["cost"])
  const costMicrocents = cost === null ? null : usdToMicrocents(cost)
  return {
    ...extracted,
    cost,
    costMicrocents,
    generationId,
    generationUsage: body,
  }
}

export const hasPositiveUsageBalance = async (workspaceId: string) => {
  const currentWorkspace = await db.query.workspace.findFirst({
    where: eq(workspace.id, workspaceId),
    columns: { creditBalance: true },
  })
  return (currentWorkspace?.creditBalance ?? 0) > 0
}

export type ReviewUsageDebitInput = {
  workspaceId: string
  reviewRunId: string
  pullRequestId: string
  repositoryId: string
  modelId: string
  verifierModelId: string
  llmCostMicrocents: number
  llmUsage: Record<string, unknown>
  vector: {
    writeBytes: number
    queryBytes: number
    networkBytes: number
    queryCount: number
    writeCostMicrocents: number
    queryCostMicrocents: number
    networkCostMicrocents: number
  }
}

export const debitReviewUsage = async (input: ReviewUsageDebitInput) =>
  db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.workspaceId}))`)

    const idempotencyKey = `review-usage:${input.reviewRunId}`
    const existing = await tx.query.workspaceCreditTransaction.findFirst({
      where: eq(workspaceCreditTransaction.idempotencyKey, idempotencyKey),
    })
    if (existing) return existing

    const currentWorkspace = await tx.query.workspace.findFirst({
      where: eq(workspace.id, input.workspaceId),
    })
    if (!currentWorkspace) return null

    const totalCostMicrocents =
      input.llmCostMicrocents +
      input.vector.writeCostMicrocents +
      input.vector.queryCostMicrocents +
      input.vector.networkCostMicrocents
    if (totalCostMicrocents <= 0) return null

    const balanceAfter = currentWorkspace.creditBalance - totalCostMicrocents

    await tx
      .update(workspace)
      .set({
        creditBalance: balanceAfter,
        updatedAt: new Date(),
      })
      .where(eq(workspace.id, input.workspaceId))

    const [transaction] = await tx
      .insert(workspaceCreditTransaction)
      .values({
        id: randomUUID(),
        workspaceId: input.workspaceId,
        type: "usage_debit",
        amount: -totalCostMicrocents,
        balanceAfter,
        idempotencyKey,
        reason: "review_usage",
        metadata: {
          reviewRunId: input.reviewRunId,
          pullRequestId: input.pullRequestId,
          repositoryId: input.repositoryId,
          modelId: input.modelId,
          verifierModelId: input.verifierModelId,
          llmCostMicrocents: input.llmCostMicrocents,
          llmUsage: input.llmUsage,
          vector: input.vector,
          totalCostMicrocents,
        },
      })
      .returning()

    return transaction
  })
