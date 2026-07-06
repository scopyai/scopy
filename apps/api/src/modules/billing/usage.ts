import { randomUUID } from "node:crypto"
import { eq, sql } from "drizzle-orm"
import { db } from "../../db/client"
import {
  reviewUsage,
  workspace,
  type ReviewUsageModel,
} from "../../db/schema"
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

const stringAt = (value: unknown, path: string[]) => {
  let current = value
  for (const key of path) {
    if (!isRecord(current)) return null
    current = current[key]
  }
  return typeof current === "string" && current.length > 0 ? current : null
}

const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms))

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
  generationLookupError?: string
  costStatus?: "resolved" | "missing_generation_id" | "generation_lookup_failed"
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
        generationLookupError: cost.generationLookupError,
        costStatus: cost.costStatus,
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
  return stringAt(generation, [
    "providerMetadata",
    "gateway",
    "generationId",
  ])
}

type GatewayGenerationInfo = {
  totalCost?: number
}

const DEFAULT_GATEWAY_GENERATION_INFO_RETRY_DELAYS_MS = [
  250, 500, 1_000, 2_000, 4_000,
]

const resolveGatewayGenerationInfo = async (
  generationId: string,
  getGenerationInfo: (params: { id: string }) => Promise<GatewayGenerationInfo>,
  retryDelaysMs: number[]
) => {
  let lastError: unknown
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    try {
      return {
        generationUsage: await getGenerationInfo({ id: generationId }),
        generationLookupError: undefined,
      }
    } catch (error) {
      lastError = error
      const retryDelayMs = retryDelaysMs[attempt]
      if (retryDelayMs !== undefined) {
        await sleep(retryDelayMs)
      }
    }
  }
  return {
    generationUsage: null,
    generationLookupError:
      lastError instanceof Error ? lastError.message : String(lastError),
  }
}

export const resolveGatewayGenerationCost = async (
  generation: unknown,
  getGenerationInfo: (params: { id: string }) => Promise<GatewayGenerationInfo>,
  options: { retryDelaysMs?: number[] } = {}
) =>
  resolveGenerationCost(generation, async (step) => {
    const generationId = extractGatewayGenerationId(step)
    let generationUsage: GatewayGenerationInfo | null = null
    let generationLookupError: string | undefined
    if (generationId) {
      const resolved = await resolveGatewayGenerationInfo(
        generationId,
        getGenerationInfo,
        options.retryDelaysMs ??
          DEFAULT_GATEWAY_GENERATION_INFO_RETRY_DELAYS_MS
      )
      generationUsage = resolved.generationUsage
      generationLookupError = resolved.generationLookupError
    }
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
      generationLookupError,
      costStatus:
        costMicrocents !== null
          ? "resolved"
          : generationId
            ? "generation_lookup_failed"
            : "missing_generation_id",
    }
  })

export type ReserveReviewCreditsResult =
  | {
      ok: true
      creditsCharged: number
      balanceAfter: number
    }
  | {
      ok: false
      requiredCredits: number
      availableCredits: number
    }

export const reserveReviewCredits = async ({
  workspaceId,
  reviewRunId,
  repositoryId,
  pullRequestId,
  credits,
  reviewableAdditions,
  reviewableDeletions,
  reviewableChangedLines,
}: {
  workspaceId: string
  reviewRunId: string
  repositoryId: string | null
  pullRequestId: string | null
  credits: number
  reviewableAdditions: number
  reviewableDeletions: number
  reviewableChangedLines: number
}): Promise<ReserveReviewCreditsResult> =>
  db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${workspaceId}))`
    )

    const existing = await tx.query.reviewUsage.findFirst({
      where: eq(reviewUsage.reviewRunId, reviewRunId),
      columns: {
        creditsCharged: true,
        creditBalanceAfter: true,
      },
    })
    if (existing) {
      return {
        ok: true,
        creditsCharged: existing.creditsCharged,
        balanceAfter: existing.creditBalanceAfter,
      }
    }

    const currentWorkspace = await tx.query.workspace.findFirst({
      where: eq(workspace.id, workspaceId),
      columns: {
        includedCreditBalance: true,
        purchasedCreditBalance: true,
      },
    })
    const includedCreditBalance =
      currentWorkspace?.includedCreditBalance ?? 0
    const purchasedCreditBalance =
      currentWorkspace?.purchasedCreditBalance ?? 0
    const availableCredits =
      includedCreditBalance + purchasedCreditBalance

    if (!currentWorkspace || availableCredits < credits) {
      return {
        ok: false,
        requiredCredits: credits,
        availableCredits,
      }
    }

    const includedDebit = Math.min(includedCreditBalance, credits)
    const purchasedDebit = credits - includedDebit
    const nextIncludedCreditBalance = includedCreditBalance - includedDebit
    const nextPurchasedCreditBalance = purchasedCreditBalance - purchasedDebit
    const balanceAfter =
      nextIncludedCreditBalance + nextPurchasedCreditBalance

    await tx
      .update(workspace)
      .set({
        includedCreditBalance: nextIncludedCreditBalance,
        purchasedCreditBalance: nextPurchasedCreditBalance,
        updatedAt: new Date(),
      })
      .where(eq(workspace.id, workspaceId))

    await tx.insert(reviewUsage).values({
      id: randomUUID(),
      workspaceId,
      reviewRunId,
      repositoryId,
      pullRequestId,
      creditsCharged: credits,
      includedCreditsCharged: includedDebit,
      purchasedCreditsCharged: purchasedDebit,
      creditBalanceAfter: balanceAfter,
      reviewableAdditions,
      reviewableDeletions,
      reviewableChangedLines,
      modelId: "",
      verifierModelId: "",
      llmCostMicrocents: 0,
      totalCostMicrocents: 0,
    })

    return {
      ok: true,
      creditsCharged: credits,
      balanceAfter,
    }
  })

export const refundReviewCredits = async ({
  workspaceId,
  reviewRunId,
}: {
  workspaceId: string
  reviewRunId: string
}) =>
  db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${workspaceId}))`
    )

    const usage = await tx.query.reviewUsage.findFirst({
      where: eq(reviewUsage.reviewRunId, reviewRunId),
      columns: {
        creditsCharged: true,
        includedCreditsCharged: true,
        purchasedCreditsCharged: true,
      },
    })
    if (!usage || usage.creditsCharged <= 0) return

    const currentWorkspace = await tx.query.workspace.findFirst({
      where: eq(workspace.id, workspaceId),
      columns: {
        includedCreditBalance: true,
        purchasedCreditBalance: true,
      },
    })
    if (!currentWorkspace) return

    const includedRefund = usage.includedCreditsCharged
    const purchasedRefund = usage.purchasedCreditsCharged
    const nextIncludedCreditBalance =
      currentWorkspace.includedCreditBalance + includedRefund
    const nextPurchasedCreditBalance =
      currentWorkspace.purchasedCreditBalance + purchasedRefund

    await tx
      .update(workspace)
      .set({
        includedCreditBalance: nextIncludedCreditBalance,
        purchasedCreditBalance: nextPurchasedCreditBalance,
        updatedAt: new Date(),
      })
      .where(eq(workspace.id, workspaceId))

    await tx.delete(reviewUsage).where(eq(reviewUsage.reviewRunId, reviewRunId))
  })

const numberOrZero = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : 0

/**
 * Flattens the per-stage `billing.llm` map produced by the review agent into a
 * normalized list of one entry per stage for internal cost analytics.
 */
export const flattenBillingModels = (
  llm: Record<string, unknown>,
): ReviewUsageModel[] =>
  Object.entries(llm).flatMap(([stage, value]) => {
    if (typeof value !== "object" || value === null) return []
    const entry = value as Record<string, unknown>
    return [
      {
        stage,
        modelId: typeof entry.modelId === "string" ? entry.modelId : "unknown",
        provider: typeof entry.provider === "string" ? entry.provider : null,
        costMicrocents: numberOrZero(entry.costMicrocents),
        usage: entry.usage,
      },
    ]
  })

export type RecordReviewUsageInput = {
  reviewRunId: string
  workspaceId: string
  repositoryId: string | null
  pullRequestId: string | null
  modelId: string
  verifierModelId: string
  billing: {
    llmCostMicrocents: number
    vectorWriteCostMicrocents: number
    vectorQueryCostMicrocents: number
    vectorNetworkCostMicrocents: number
    totalCostMicrocents: number
    vectorWriteBytes: number
    vectorQueryBytes: number
    vectorNetworkBytes: number
    vectorQueryCount: number
    llm: Record<string, unknown>
  }
  creditsCharged?: number
  reviewableAdditions?: number
  reviewableDeletions?: number
  reviewableChangedLines?: number
}

/**
 * Records the per-review compute usage breakdown. User-facing integer review
 * credits are reserved before the review starts; actual provider cost remains
 * here for internal analytics and transparency only.
 */
export const recordReviewUsage = async (input: RecordReviewUsageInput) =>
  db.transaction(async (tx) => {
    const existing = await tx.query.reviewUsage.findFirst({
      where: eq(reviewUsage.reviewRunId, input.reviewRunId),
      columns: { id: true },
    })
    const values = {
      workspaceId: input.workspaceId,
      repositoryId: input.repositoryId,
      pullRequestId: input.pullRequestId,
      reviewableAdditions: input.reviewableAdditions ?? 0,
      reviewableDeletions: input.reviewableDeletions ?? 0,
      reviewableChangedLines: input.reviewableChangedLines ?? 0,
      modelId: input.modelId,
      verifierModelId: input.verifierModelId,
      llmCostMicrocents: input.billing.llmCostMicrocents,
      vectorWriteCostMicrocents: input.billing.vectorWriteCostMicrocents,
      vectorQueryCostMicrocents: input.billing.vectorQueryCostMicrocents,
      vectorNetworkCostMicrocents: input.billing.vectorNetworkCostMicrocents,
      totalCostMicrocents: input.billing.totalCostMicrocents,
      vectorWriteBytes: input.billing.vectorWriteBytes,
      vectorQueryBytes: input.billing.vectorQueryBytes,
      vectorNetworkBytes: input.billing.vectorNetworkBytes,
      vectorQueryCount: input.billing.vectorQueryCount,
      models: flattenBillingModels(input.billing.llm),
    }

    if (existing) {
      await tx
        .update(reviewUsage)
        .set(values)
        .where(eq(reviewUsage.reviewRunId, input.reviewRunId))
      return
    }

    await tx
      .insert(reviewUsage)
      .values({
        id: randomUUID(),
        reviewRunId: input.reviewRunId,
        ...values,
        creditsCharged: input.creditsCharged ?? 0,
      })
      .onConflictDoNothing({ target: reviewUsage.reviewRunId })
  })
