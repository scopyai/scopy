import { randomUUID } from "node:crypto"
import { eq, sql } from "drizzle-orm"
import { db } from "../../db/client"
import { workspace, workspaceCreditTransaction } from "../../db/schema"
import { env } from "../../env"

export const MICRO_USD_PER_USD = 1_000_000
export const MICROCENTS_PER_USD = MICRO_USD_PER_USD
const BYTES_PER_GIB = 1024 ** 3
const BYTES_PER_TIB = 1024 ** 4

const ceilDiv = (numerator: bigint, denominator: bigint) =>
  (numerator + denominator - 1n) / denominator

export const usdToMicroUsd = (usd: number) => {
  if (!Number.isFinite(usd) || usd < 0) return null
  return Math.ceil(usd * MICRO_USD_PER_USD)
}

export const usdToMicrocents = usdToMicroUsd

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
  const costMicrocents = cost === null ? null : usdToMicroUsd(cost)
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
  const costMicrocents = cost === null ? null : usdToMicroUsd(cost)
  return {
    ...extracted,
    cost,
    costMicrocents,
    generationId,
    generationUsage: body,
  }
}

const stepsFromGeneration = (generation: unknown) => {
  if (
    isRecord(generation) &&
    Array.isArray(generation.steps) &&
    generation.steps.length > 0
  ) {
    return generation.steps
  }
  return [generation]
}

const stepNumberOf = (step: unknown, fallback: number) =>
  isRecord(step) && typeof step.stepNumber === "number"
    ? step.stepNumber
    : fallback

const usageOf = (value: unknown) => {
  if (!isRecord(value)) return undefined
  return "usage" in value ? value.usage : undefined
}

type ResolvedStepCost = {
  cost: number | null
  costMicrocents: number | null
  providerMetadata?: unknown
  generationId?: string
  generationUsage?: unknown
}

const resolveGenerationCost = async (
  generation: unknown,
  resolveStepCost: (
    step: unknown
  ) => Promise<ResolvedStepCost> | ResolvedStepCost
) => {
  const steps = stepsFromGeneration(generation)
  const resolvedSteps = await Promise.all(
    steps.map(async (step, index) => {
      const cost = await resolveStepCost(step)
      return {
        stepNumber: stepNumberOf(step, index),
        usage: usageOf(step),
        costUsd: cost.cost,
        costMicroUsd: cost.costMicrocents,
        costMicrocents: cost.costMicrocents,
        providerMetadata: cost.providerMetadata,
        generationId: cost.generationId,
        generationUsage: cost.generationUsage,
      }
    })
  )

  if (resolvedSteps.some((step) => step.costMicrocents === null)) {
    return {
      cost: null,
      costMicrocents: null,
      steps: resolvedSteps,
    }
  }

  return {
    cost: resolvedSteps.reduce((total, step) => total + (step.costUsd ?? 0), 0),
    costMicrocents: resolvedSteps.reduce(
      (total, step) => total + (step.costMicrocents ?? 0),
      0
    ),
    steps: resolvedSteps,
  }
}

export const resolveOpenRouterGenerationCost = (generation: unknown) =>
  resolveGenerationCost(generation, async (step) => {
    const cost = await resolveOpenRouterCost(step)
    return {
      cost: cost.cost,
      costMicrocents: cost.costMicrocents,
      providerMetadata: cost.providerMetadata,
      generationId: cost.generationId,
      generationUsage: cost.generationUsage,
    }
  })

const extractGatewayGenerationId = (generation: unknown) => {
  const generationId = numberAt(generation, [
    "providerMetadata",
    "gateway",
    "generationId",
  ])
  if (generationId !== null) return String(generationId)
  return isRecord(generation) &&
    isRecord(generation.providerMetadata) &&
    isRecord(generation.providerMetadata.gateway) &&
    typeof generation.providerMetadata.gateway.generationId === "string"
    ? generation.providerMetadata.gateway.generationId
    : null
}

type GatewayGenerationInfo = {
  totalCost?: number
}

export const resolveGatewayGenerationCost = async (
  generation: unknown,
  getGenerationInfo: (params: { id: string }) => Promise<GatewayGenerationInfo>
) =>
  resolveGenerationCost(generation, async (step) => {
    const generationId = extractGatewayGenerationId(step)
    const generationUsage = generationId
      ? await getGenerationInfo({ id: generationId }).catch(() => null)
      : null
    const cost =
      generationUsage?.totalCost ??
      numberAt(step, ["providerMetadata", "gateway", "cost"]) ??
      numberAt(step, ["providerMetadata", "gateway", "totalCost"])
    const costMicrocents = cost === null ? null : usdToMicroUsd(cost)
    return {
      cost,
      costMicrocents,
      providerMetadata: isRecord(step) ? step.providerMetadata : undefined,
      generationId: generationId ?? undefined,
      generationUsage,
    }
  })

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
          billingUnit: "micro_usd",
          reviewRunId: input.reviewRunId,
          pullRequestId: input.pullRequestId,
          repositoryId: input.repositoryId,
          modelId: input.modelId,
          verifierModelId: input.verifierModelId,
          llmCostMicroUsd: input.llmCostMicrocents,
          llmCostMicrocents: input.llmCostMicrocents,
          llmUsage: input.llmUsage,
          vector: input.vector,
          totalCostMicroUsd: totalCostMicrocents,
          totalCostMicrocents,
        },
      })
      .returning()

    return transaction
  })
