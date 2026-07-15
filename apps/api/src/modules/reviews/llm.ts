import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import { createGateway, type ToolLoopAgentSettings } from "ai"
import { env } from "../../env"
import {
  resolveGatewayGenerationCost,
  resolveOpenRouterGenerationCost,
} from "../billing/usage"
import { reviewAgentConfig, type ReviewReasoningEffort } from "./config"

export const reviewModels = {
  main: env.REVIEW_MODEL,
  subagent: env.REVIEW_SUBAGENT_MODEL ?? env.REVIEW_VERIFIER_MODEL,
  verifier: env.REVIEW_VERIFIER_MODEL,
}

export const createReviewLlm = () => {
  const openrouter = env.OPENROUTER_API_KEY
    ? createOpenRouter({ apiKey: env.OPENROUTER_API_KEY })
    : null
  const gateway =
    !openrouter && env.AI_GATEWAY_API_KEY
      ? createGateway({ apiKey: env.AI_GATEWAY_API_KEY })
      : null
  if (!openrouter && !gateway) {
    throw new Error(
      "OPENROUTER_API_KEY or AI_GATEWAY_API_KEY is required to run the review agent"
    )
  }

  const chatModel = (modelId: string) => {
    if (!openrouter) return gateway!.chat(modelId)
    return modelId.startsWith("openai/")
      ? openrouter.chat(modelId, {
          extraBody: { service_tier: reviewAgentConfig.openai.serviceTier },
        })
      : openrouter.chat(modelId)
  }

  type ProviderOptions = ToolLoopAgentSettings["providerOptions"]
  const providerOptionsFor = (
    modelId: string,
    reasoningEffort: ReviewReasoningEffort
  ): ProviderOptions => {
    if (openrouter) {
      return modelId.startsWith("openai/")
        ? { openrouter: { reasoning: { effort: reasoningEffort } } }
        : undefined
    }
    const options: NonNullable<ProviderOptions> = {}
    if (modelId.startsWith("openai/")) {
      options.openai = { reasoningEffort }
    }
    const serviceTier = reviewAgentConfig.openai.serviceTier
    if (serviceTier !== "default") {
      options.gateway = { serviceTier }
    }
    return Object.keys(options).length > 0 ? options : undefined
  }

  return {
    provider: (openrouter ? "openrouter" : "gateway") as
      | "openrouter"
      | "gateway",
    chatModel,
    providerOptionsFor,
    resolveGenerationCost: openrouter
      ? resolveOpenRouterGenerationCost
      : (generation: unknown, options?: { retryDelaysMs?: number[] }) =>
          resolveGatewayGenerationCost(
            generation,
            gateway!.getGenerationInfo,
            options
          ),
  }
}

export type ReviewLlm = ReturnType<typeof createReviewLlm>

const extractFirstJsonValue = (text: string) => {
  const start = text.search(/[{[]/)
  if (start === -1) return text
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const character = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (character === "\\") escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') {
      inString = true
      continue
    }
    if (character === "{" || character === "[") depth += 1
    else if (character === "}" || character === "]") {
      depth -= 1
      if (depth === 0) return text.slice(start, index + 1)
    }
  }
  return text
}

export const repairedJsonOutput = <
  T extends {
    parseCompleteOutput: (args: { text: string }, context: never) => unknown
  },
>(
  output: T
): T => ({
  ...output,
  parseCompleteOutput: ((args: { text: string }, context: never) =>
    output.parseCompleteOutput(
      { ...args, text: extractFirstJsonValue(args.text) },
      context
    )) as T["parseCompleteOutput"],
})

export const recordLlmBilling = async (
  stages: Record<string, unknown>,
  stage: string,
  modelId: string,
  generation: unknown,
  provider: "openrouter" | "gateway",
  resolveGenerationCost: (
    generation: unknown,
    options?: { retryDelaysMs?: number[] }
  ) => ReturnType<typeof resolveOpenRouterGenerationCost>,
  options?: { retryDelaysMs?: number[] }
) => {
  const usage =
    typeof generation === "object" &&
    generation !== null &&
    "totalUsage" in generation
      ? (generation as { totalUsage: unknown }).totalUsage
      : undefined
  const providerMetadata =
    typeof generation === "object" &&
    generation !== null &&
    "providerMetadata" in generation
      ? (generation as { providerMetadata: unknown }).providerMetadata
      : undefined
  const appendEntry = (entry: {
    modelId: string
    provider: "openrouter" | "gateway"
    usage: unknown
    billingUnit: "micro_usd"
    costUsd: number
    costMicroUsd: number
    costMicrocents: number
    costStatus?: "partial" | "missing"
    billingError?: string
    steps: unknown[]
    stepCount: number
    providerMetadata: unknown
  }) => {
    const existing = stages[stage]
    if (
      existing &&
      typeof existing === "object" &&
      "costMicrocents" in existing &&
      typeof (existing as { costMicrocents?: unknown }).costMicrocents ===
        "number"
    ) {
      const existingEntry = existing as {
        costUsd?: number
        costMicroUsd: number
        costMicrocents: number
        costStatus?: string
        billingError?: string
        stepCount?: number
        steps?: unknown[]
        calls?: unknown[]
      }
      stages[stage] = {
        ...existingEntry,
        costUsd: (existingEntry.costUsd ?? 0) + entry.costUsd,
        costMicroUsd: existingEntry.costMicroUsd + entry.costMicroUsd,
        costMicrocents: existingEntry.costMicrocents + entry.costMicrocents,
        ...(entry.costStatus || existingEntry.costStatus
          ? {
              costStatus:
                entry.costStatus === "missing" ||
                existingEntry.costStatus === "missing"
                  ? "missing"
                  : "partial",
            }
          : {}),
        ...(entry.billingError || existingEntry.billingError
          ? {
              billingError: [existingEntry.billingError, entry.billingError]
                .filter(Boolean)
                .join("; "),
            }
          : {}),
        steps: [...(existingEntry.steps ?? []), ...entry.steps],
        stepCount: (existingEntry.stepCount ?? 0) + entry.stepCount,
        calls: [...(existingEntry.calls ?? []), entry],
      }
    } else {
      stages[stage] = { ...entry, calls: [entry] }
    }
  }
  let cost: Awaited<ReturnType<typeof resolveOpenRouterGenerationCost>>
  try {
    cost = await resolveGenerationCost(generation, options)
  } catch (error) {
    appendEntry({
      modelId,
      provider,
      usage,
      billingUnit: "micro_usd" as const,
      costUsd: 0,
      costMicroUsd: 0,
      costMicrocents: 0,
      costStatus: "missing",
      billingError:
        error instanceof Error ? error.message : "Could not resolve cost.",
      steps: [],
      stepCount: 0,
      providerMetadata,
    })
    return usage
  }
  const resolvedStepCostMicrocents = cost.steps.reduce<number>(
    (total, step) => {
      if (
        typeof step === "object" &&
        step !== null &&
        "costMicrocents" in step &&
        typeof (step as { costMicrocents?: unknown }).costMicrocents ===
          "number"
      ) {
        return total + (step as { costMicrocents: number }).costMicrocents
      }
      return total
    },
    0
  )
  const resolvedStepCostUsd = cost.steps.reduce<number>((total, step) => {
    if (
      typeof step === "object" &&
      step !== null &&
      "costUsd" in step &&
      typeof (step as { costUsd?: unknown }).costUsd === "number"
    ) {
      return total + (step as { costUsd: number }).costUsd
    }
    return total
  }, 0)
  const costIsPartial = cost.costMicrocents === null
  let costStatus: "partial" | "missing" | undefined = costIsPartial
    ? "partial"
    : undefined
  let billingError: string | undefined
  if (costIsPartial && resolvedStepCostMicrocents <= 0) {
    const statusCounts = cost.steps.reduce<Record<string, number>>(
      (counts, step) => {
        if (
          typeof step === "object" &&
          step !== null &&
          "costStatus" in step &&
          typeof (step as { costStatus?: unknown }).costStatus === "string"
        ) {
          const status = (step as { costStatus: string }).costStatus
          counts[status] = (counts[status] ?? 0) + 1
        }
        return counts
      },
      {}
    )
    const detail = Object.entries(statusCounts)
      .map(([status, count]) => `${status}: ${count}`)
      .join(", ")
    costStatus = "missing"
    billingError = `${provider} cost is missing for ${stage}${detail ? ` (${detail})` : ""}`
  }
  const recordedCostUsd = costIsPartial ? resolvedStepCostUsd : (cost.cost ?? 0)
  const recordedCostMicrocents = costIsPartial
    ? resolvedStepCostMicrocents
    : (cost.costMicrocents ?? 0)
  appendEntry({
    modelId,
    provider,
    usage,
    billingUnit: "micro_usd" as const,
    costUsd: recordedCostUsd,
    costMicroUsd: recordedCostMicrocents,
    costMicrocents: recordedCostMicrocents,
    ...(costStatus ? { costStatus } : {}),
    ...(billingError ? { billingError } : {}),
    steps: cost.steps,
    stepCount: cost.steps.length,
    providerMetadata,
  })
  return usage
}
