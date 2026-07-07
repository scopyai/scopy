import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import { createGateway, Output, ToolLoopAgent, stepCountIs, tool } from "ai"
import {
  buildDiffContext,
  chunksForRepositoryIndex,
  getSymbolCallers,
  getSymbolDefinition,
  indexReviewCodebase,
  readRepositoryFile,
  searchReviewCode,
  searchRepositoryText,
  parseUnifiedDiff,
} from "tools"
import { z } from "zod"
import { env } from "../../env"
import type { pullRequest, repository } from "../../db/schema"
import {
  calculateVectorNetworkCostMicrocents,
  calculateVectorQueryCostMicrocents,
  calculateVectorWriteCostMicrocents,
  resolveGatewayGenerationCost,
  resolveOpenRouterGenerationCost,
} from "../billing/usage"
import type { PullRequestFile } from "./diff"
import {
  batchNaturalLanguageLinterFiles,
  serializePullRequestFiles,
} from "./diff"
import {
  findOrCreateReviewComment,
  publishPullRequestReview,
  type PullRequestReviewEvent,
  reviewFailedBody,
  updateReviewComment,
} from "./github"
import { validateReviewReportEvidence } from "./evidence"
import {
  buildReviewFindingDeduplicationPrompt,
  buildMainReviewPrompt,
  buildNaturalLanguageLinterPrompt,
  buildReviewVerifierPrompt,
  mainReviewAgentInstructions,
  mainReviewAgentWithVerificationInstructions,
  naturalLanguageLinterInstructions,
  naturalLanguageLinterOutputSchema,
  renderAffectedSymbols,
  renderReviewSummaryComment,
  renderSemanticCoverage,
  reviewReportSchema,
  reviewSubagentInstructions,
  reviewSubagentOutputSchema,
  reviewSuspicionDecisionSchema,
  reviewFindingDeduplicationInstructions,
  reviewFindingDeduplicationOutputSchema,
  reviewVerifierOutputSchema,
  reviewVerifierInstructions,
  safePathSegment,
  type ReviewReport,
} from "./prompt"
import { createReviewRunRecorder } from "./debug-run"
import { reviewAgentConfig } from "./config"
import { prepareRepositoryContextForReview } from "./repository-context"
import { prepareReviewRuntime } from "./runtime"
import type { ReviewConfigValues } from "./review-config"

export const REVIEW_MODEL = env.REVIEW_MODEL
export const REVIEW_VERIFIER_MODEL =
  env.REVIEW_VERIFIER_MODEL ?? env.REVIEW_MODEL
const reviewModelProviderOptions = REVIEW_MODEL.startsWith("openai/")
  ? {
      openrouter: {
        reasoning: {
          effort: reviewAgentConfig.main.reasoningEffort,
        },
      },
    }
  : undefined
const verifierModelProviderOptions = REVIEW_VERIFIER_MODEL.startsWith("openai/")
  ? {
      openrouter: {
        reasoning: {
          effort: reviewAgentConfig.subagent.reasoningEffort,
        },
      },
    }
  : undefined
const verificationModelProviderOptions = REVIEW_VERIFIER_MODEL.startsWith(
  "openai/"
)
  ? {
      openrouter: {
        reasoning: {
          effort: reviewAgentConfig.verification.reasoningEffort,
        },
      },
    }
  : undefined

type Logger = {
  info: (message: string, details?: Record<string, unknown>) => void
  error: (message: string, details?: Record<string, unknown>) => void
}

export type ReviewPreflight = {
  fetchedFileCount: number
  filteredFiles: PullRequestFile[]
  omittedFiles: PullRequestFile[]
  diff: string
  unifiedDiff: string
  additions: number
  deletions: number
  diffChangedLineCount: number
}

type RunInput = {
  reviewRunId: string
  pullRequest: typeof pullRequest.$inferSelect
  repository: typeof repository.$inferSelect
  reviewConfig: ReviewConfigValues
  installationId: string
  triggerSource: string
  logger: Logger
  preflight: ReviewPreflight
}

export type ReviewAgentResult = {
  kind: "summary"
  summary?: string
  triggerSource: string
  modelId: string
  verifierModelId?: string
  fetchedFileCount: number
  filteredFileCount: number
  diffChangedLineCount: number
  commentId: number
  reviewId?: number
  reviewEvent?: PullRequestReviewEvent
  inlineCommentCount?: number
  inlineReviewPublishError?: string
  mergeSafetyScore?: number
  findings?: ReviewReport["findings"]
  usage?: Record<string, unknown>
  billing?: {
    billingUnit: "micro_usd"
    llmCostMicroUsd: number
    llmCostMicrocents: number
    vectorWriteBytes: number
    vectorQueryBytes: number
    vectorNetworkBytes: number
    vectorQueryCount: number
    vectorWriteCostMicroUsd: number
    vectorWriteCostMicrocents: number
    vectorQueryCostMicroUsd: number
    vectorQueryCostMicrocents: number
    vectorNetworkCostMicroUsd: number
    vectorNetworkCostMicrocents: number
    totalCostMicroUsd: number
    totalCostMicrocents: number
    llm: Record<string, unknown>
  }
  startedAt: string
  completedAt: string
  durationMs: number
}

const openRouterChat = (
  openrouter: ReturnType<typeof createOpenRouter>,
  modelId: string
) =>
  modelId.startsWith("openai/")
    ? openrouter.chat(modelId, {
        extraBody: { service_tier: reviewAgentConfig.openai.serviceTier },
      })
    : openrouter.chat(modelId)

const toolText = (text: string, maxBytes = 90_000) => {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text
  let output = text
  while (Buffer.byteLength(output, "utf8") > maxBytes) {
    output = output.slice(0, Math.floor(output.length * 0.9))
  }
  return `${output}\n\n[truncated]`
}

const textBytes = (text: string) => Buffer.byteLength(text, "utf8")

const renderChangedLineMap = (changedLinesByFile: Map<string, number[]>) => {
  const lines = [...changedLinesByFile.entries()]
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([file, changedLines]) => {
      const lineList =
        changedLines.length > 0
          ? changedLines
              .slice()
              .sort((first, second) => first - second)
              .join(", ")
          : "none"
      return `- ${file}: ${lineList}`
    })
  return lines.length > 0 ? lines.join("\n") : "(none)"
}

const recordLlmBilling = async (
  stages: Record<string, unknown>,
  stage: string,
  modelId: string,
  generation: unknown,
  provider: "openrouter" | "gateway",
  resolveGenerationCost: typeof resolveOpenRouterGenerationCost
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
        costMicrocents:
          existingEntry.costMicrocents + entry.costMicrocents,
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
    cost = await resolveGenerationCost(generation)
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
  const entry = {
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
  }
  appendEntry(entry)
  return usage
}

export const runReviewAgent = async ({
  pullRequest,
  reviewRunId,
  repository,
  reviewConfig,
  installationId,
  triggerSource,
  logger,
  preflight,
}: RunInput): Promise<ReviewAgentResult> => {
  const startedAt = Date.now()
  const startedAtIso = new Date(startedAt).toISOString()
  const context = {
    pullRequestId: pullRequest.id,
    repository: repository.fullName,
    headSha: pullRequest.headSha,
    triggerSource,
    modelId: REVIEW_MODEL,
    verifierModelId: REVIEW_VERIFIER_MODEL,
  }
  const reviewCommentRunId =
    triggerSource === "mention" ? reviewRunId : undefined
  const recorder = await createReviewRunRecorder({
    reviewRunId,
    repo: repository,
    pullRequest,
    triggerSource,
    modelId: REVIEW_MODEL,
  })
  await recorder.appendEvent("review.started", context)

  logger.info("Review agent stage started", { ...context, stage: "comment" })
  const commentId = await findOrCreateReviewComment({
    repo: repository,
    installationId,
    pullRequestNumber: pullRequest.number,
    pullRequestId: pullRequest.id,
    reviewRunId: reviewCommentRunId,
  })
  logger.info("Review agent stage completed", {
    ...context,
    stage: "comment",
    commentId,
  })
  await recorder.writeJson("comment.json", { commentId })
  await recorder.appendEvent("stage.completed", { stage: "comment", commentId })

  logger.info("Review agent stage started", { ...context, stage: "diff" })
  await recorder.appendEvent("stage.started", { stage: "diff" })
  const {
    fetchedFileCount,
    filteredFiles,
    omittedFiles,
    diff,
    unifiedDiff,
    additions,
    deletions,
    diffChangedLineCount,
  } = preflight
  await recorder.writeJson("review-config.json", reviewConfig)
  await recorder.writeJson("filtered-files.json", filteredFiles)
  await recorder.writeJson("omitted-files.json", omittedFiles)
  await recorder.writeText("context/diff.md", diff)
  await recorder.writeText("context/unified.diff", unifiedDiff)
  logger.info("Review agent stage completed", {
    ...context,
    stage: "diff",
    fetchedFileCount,
    filteredFileCount: filteredFiles.length,
    omittedFileCount: omittedFiles.length,
    additions,
    deletions,
    diffChangedLineCount,
  })
  await recorder.appendEvent("stage.completed", {
    stage: "diff",
    fetchedFileCount,
    filteredFileCount: filteredFiles.length,
    omittedFileCount: omittedFiles.length,
    additions,
    deletions,
    diffChangedLineCount,
  })

  logger.info("Review agent stage started", { ...context, stage: "runtime" })
  await recorder.appendEvent("stage.started", { stage: "runtime" })
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
  const provider = openrouter ? "openrouter" : "gateway"
  const mainModel = openrouter
    ? openRouterChat(openrouter, REVIEW_MODEL)
    : gateway!.chat(REVIEW_MODEL)
  const subagentModel = openrouter
    ? openRouterChat(openrouter, REVIEW_VERIFIER_MODEL)
    : gateway!.chat(REVIEW_VERIFIER_MODEL)
  const resolveGenerationCost = openrouter
    ? resolveOpenRouterGenerationCost
    : (generation: unknown) =>
        resolveGatewayGenerationCost(generation, gateway!.getGenerationInfo)
  const mainProviderOptions = openrouter
    ? reviewModelProviderOptions
    : undefined
  const subagentProviderOptions = openrouter
    ? verifierModelProviderOptions
    : undefined
  const verificationProviderOptions = openrouter
    ? verificationModelProviderOptions
    : undefined
  const llmBilling: Record<string, unknown> = {}
  const recordBilling = (stage: string, modelId: string, generation: unknown) =>
    recordLlmBilling(
      llmBilling,
      stage,
      modelId,
      generation,
      provider,
      resolveGenerationCost
    )
  const runtime = await prepareReviewRuntime({
    reviewRunId,
    repo: repository,
    pullRequest,
    installationId,
    changedFiles: filteredFiles.map((file) => file.filename),
  })
  const parsedDiffFiles = parseUnifiedDiff(unifiedDiff)
  const changedLinesByFile = new Map<string, number[]>()
  for (const diffFile of parsedDiffFiles) {
    const file =
      diffFile.newPath && diffFile.newPath !== "/dev/null"
        ? diffFile.newPath
        : diffFile.oldPath
    if (!file || file === "/dev/null" || diffFile.status === "deleted") {
      continue
    }
    changedLinesByFile.set(file, [
      ...new Set(diffFile.hunks.flatMap((hunk) => hunk.touchedNewLines)),
    ])
  }
  const changedLineMap = renderChangedLineMap(changedLinesByFile)
  const diffContext = await buildDiffContext({
    repository: runtime.paths.repositoryPath,
    diffFiles: parsedDiffFiles,
  })
  const affectedSymbols = renderAffectedSymbols(diffContext)
  const semanticEnabled = Boolean(runtime.qdrant)
  const semanticChunks = semanticEnabled
    ? chunksForRepositoryIndex({
        index: runtime.codeIndex,
        repositoryKey: `${repository.id}:${pullRequest.headSha}`,
      })
    : []
  const semanticCoverage = semanticEnabled
    ? renderSemanticCoverage({
        diffContext,
        codeIndex: runtime.codeIndex,
        chunks: semanticChunks,
        qdrantEnabled: true,
      })
    : null
  await recorder.writeJson("runtime.json", {
    paths: runtime.paths,
    base: {
      sha: runtime.baseSha,
      repositoryPath: runtime.paths.baseRepositoryPath,
      diagnostics: runtime.baseCodeIndex.diagnostics.length,
      repositoryFiles: runtime.baseCodeIndex.repositoryFiles.length,
      parsedFiles: runtime.baseCodeIndex.files.length,
    },
    semantic: {
      enabled: semanticEnabled,
    },
    qdrant: runtime.qdrant
      ? {
          collection: runtime.qdrant.collection,
          model: runtime.qdrant.model,
          vectorSize: runtime.qdrant.vectorSize,
          configured: true,
        }
      : { configured: false },
  })
  await recorder.writeJson(
    "context/base-code-index.json",
    runtime.baseCodeIndex
  )
  await recorder.writeJson("context/code-index.json", runtime.codeIndex)
  await recorder.writeJson("context/diff-context.json", diffContext)
  await recorder.writeText("context/affected-symbols.md", affectedSymbols)
  if (semanticEnabled) {
    await recorder.writeJson("context/semantic-chunks.json", semanticChunks)
    await recorder.writeText(
      "context/semantic-coverage.md",
      semanticCoverage ?? ""
    )
  }
  let qdrantChunks = 0
  let qdrantIndexedFiles = 0
  let qdrantIgnoredFiles = 0
  let qdrantLogicalWriteBytes = 0
  if (semanticEnabled && runtime.qdrant) {
    const indexResult = await indexReviewCodebase({
      index: runtime.codeIndex,
      repositoryId: repository.id,
      repositoryKey: `${repository.id}:${pullRequest.headSha}`,
      headSha: pullRequest.headSha,
      reviewRunId,
      qdrant: runtime.qdrant,
    })
    qdrantChunks = indexResult.chunks
    qdrantIndexedFiles = indexResult.indexedFiles
    qdrantIgnoredFiles = indexResult.ignoredFiles
    qdrantLogicalWriteBytes = indexResult.logicalWriteBytes
  }
  logger.info("Review agent stage completed", {
    ...context,
    stage: "runtime",
    repositoryPath: runtime.paths.repositoryPath,
    diagnostics: runtime.codeIndex.diagnostics.length,
    semanticEnabled,
    qdrantEnabled: semanticEnabled,
    qdrantChunks,
    qdrantIndexedFiles,
    qdrantIgnoredFiles,
    qdrantLogicalWriteBytes,
  })
  await recorder.appendEvent("stage.completed", {
    stage: "runtime",
    repositoryPath: runtime.paths.repositoryPath,
    diagnostics: runtime.codeIndex.diagnostics.length,
    semanticEnabled,
    qdrantEnabled: semanticEnabled,
    qdrantChunks,
    qdrantIndexedFiles,
    qdrantIgnoredFiles,
    qdrantLogicalWriteBytes,
  })

  logger.info("Review agent stage started", {
    ...context,
    stage: "repository-context",
  })
  await recorder.appendEvent("stage.started", { stage: "repository-context" })
  const preparedRepositoryContext = await prepareRepositoryContextForReview({
    repo: repository,
    pullRequest,
    baseRepositoryPath: runtime.paths.baseRepositoryPath,
    baseIndex: runtime.baseCodeIndex,
    baseSha: runtime.baseSha,
    contextModel: mainModel,
    contextModelId: REVIEW_MODEL,
    contextProviderOptions: mainProviderOptions,
    recorder,
    logger,
  })
  if (preparedRepositoryContext.billingGeneration) {
    await recordBilling(
      "repository_context",
      REVIEW_MODEL,
      preparedRepositoryContext.billingGeneration
    )
  }
  logger.info("Review agent stage completed", {
    ...context,
    stage: "repository-context",
    source: preparedRepositoryContext.source,
    contextId: preparedRepositoryContext.contextId,
    baseSha: preparedRepositoryContext.baseSha,
    changesArchitecture:
      preparedRepositoryContext.architectureImpact.changesArchitecture,
    markdownBytes: textBytes(preparedRepositoryContext.markdown),
  })
  await recorder.appendEvent("stage.completed", {
    stage: "repository-context",
    source: preparedRepositoryContext.source,
    contextId: preparedRepositoryContext.contextId,
    baseSha: preparedRepositoryContext.baseSha,
    architectureImpact: preparedRepositoryContext.architectureImpact,
    markdownBytes: textBytes(preparedRepositoryContext.markdown),
  })

  logger.info("Review agent stage started", { ...context, stage: "generation" })
  await recorder.appendEvent("stage.started", { stage: "generation" })
  let vectorQueryBytes = 0
  let vectorNetworkBytes = 0
  let vectorQueryCount = 0
  const createRepositoryTools = (scope: string) => {
    const base = {
      read_file: tool({
        description: "Read numbered lines from any repository file.",
        inputSchema: z.object({
          file: z.string().min(1),
          startLine: z.number().int().positive().optional(),
          maxLines: z.number().int().positive().max(200).optional(),
        }),
        execute: async ({ file, startLine, maxLines }) => {
          const input = { file, startLine, maxLines }
          const output = await readRepositoryFile({
            repository: runtime.paths.repositoryPath,
            file,
            startLine,
            maxLines,
          })
          await recorder.recordToolCall({
            name: `${scope}.read_file`,
            input,
            output,
          })
          return output
        },
      }),
      get_symbol_definition: tool({
        description:
          "Get symbol definitions, signatures, locations, scopes, and source.",
        inputSchema: z.object({ symbol: z.string().min(1) }),
        execute: async ({ symbol }) => {
          const input = { symbol }
          const result = await getSymbolDefinition({
            repository: runtime.paths.repositoryPath,
            index: runtime.codeIndex,
            symbol,
          })
          const output = { ...result.json, stats: result.stats }
          await recorder.recordToolCall({
            name: `${scope}.get_symbol_definition`,
            input,
            output,
          })
          return output
        },
      }),
      get_symbol_callers: tool({
        description: "Get direct call locations and enclosing caller metadata.",
        inputSchema: z.object({ symbol: z.string().min(1) }),
        execute: async ({ symbol }) => {
          const input = { symbol }
          const result = await getSymbolCallers({
            repository: runtime.paths.repositoryPath,
            index: runtime.codeIndex,
            symbol,
          })
          const output = { ...result.json, stats: result.stats }
          await recorder.recordToolCall({
            name: `${scope}.get_symbol_callers`,
            input,
            output,
          })
          return output
        },
      }),
      locate_text: tool({
        description: "Search exact text across repository files.",
        inputSchema: z.object({ query: z.string().min(1) }),
        execute: async ({ query }) => {
          const input = { query }
          const result = await searchRepositoryText({
            repository: runtime.paths.repositoryPath,
            index: runtime.codeIndex,
            query,
            maxResults: 50,
          })
          const output = {
            ...result.stats,
            markdown: toolText(result.markdown),
          }
          await recorder.recordToolCall({
            name: `${scope}.locate_text`,
            input,
            output,
          })
          return output
        },
      }),
    }
    if (!semanticEnabled) return base
    return {
      ...base,
      search_code: tool({
        description:
          "Search code by behavior or concept when exact identifiers are unknown.",
        inputSchema: z.object({
          query: z.string().min(1),
          limit: z.number().int().positive().max(20).optional(),
        }),
        execute: async ({ query, limit = 10 }) => {
          const input = { query, limit }
          if (!runtime.qdrant)
            return {
              chunks: 0,
              markdown: "Semantic code search is unavailable.",
            }
          const result = await searchReviewCode({
            repositoryId: repository.id,
            headSha: pullRequest.headSha,
            reviewRunId,
            qdrant: runtime.qdrant,
            query,
            indexedLogicalBytes: qdrantLogicalWriteBytes,
            limit,
          })
          vectorQueryBytes += result.stats.queriedBytes
          vectorNetworkBytes += result.stats.returnedBytes
          vectorQueryCount += result.stats.queryUnits
          const output = {
            ...result.stats,
            markdown: toolText(result.markdown),
          }
          await recorder.recordToolCall({
            name: `${scope}.search_code`,
            input,
            output,
          })
          return output
        },
      }),
    }
  }

  const subagentUsages: unknown[] = []
  const verifierUsages: unknown[] = []
  const deduplicationUsages: unknown[] = []
  const linterUsages: unknown[] = []
  const allSuspicionIds = new Set<string>()
  const mainReviewSuspicionIds = new Set<string>()
  const verifierDecisions: Array<{
    suspicionId: string
    decision:
      | "accepted"
      | "not_bug"
      | "dropped_low_value"
      | "needs_main_review"
    reviewPriority?: "critical" | "high" | "medium" | "low"
    confidence: number
    reason: string
    findingIndex: number | null
  }> = []
  const verifierApprovedFindings: ReviewReport["findings"] = []
  const verificationLayerEnabled = env.REVIEW_EXPERIMENTAL_VERIFICATION_LAYER
  const compactFinding = (finding: ReviewReport["findings"][number]) => ({
    severity: finding.severity,
    file: finding.file,
    startLine: finding.startLine,
    endLine: finding.endLine,
    title: finding.title,
    confidence: finding.confidence,
  })
  const reviewPriorityRank = {
    low: 0,
    medium: 1,
    high: 2,
    critical: 3,
  }
  const shouldEscalatePriority = (
    priority: "critical" | "high" | "medium" | "low"
  ) =>
    reviewPriorityRank[priority] >=
    reviewPriorityRank[reviewAgentConfig.verification.minMainReviewPriority]
  const failedOpenSuspicionScore = (suspicion: {
    file: string
    suspicion: string
  }) => {
    const text = `${suspicion.file}\n${suspicion.suspicion}`.toLowerCase()
    const impactMatches = text.match(
      /access|auth|owner|expos|leak|public|token|credential|state|data|persist|corrupt|overwrite|drop|silent|race|crash|internal|permanent/g
    )
    return (
      (suspicion.file.includes("/api/") ? 3 : 0) +
      (impactMatches?.length ?? 0) +
      Math.min(3, Math.floor(suspicion.suspicion.length / 300))
    )
  }
  let spawnBatch = 0
  const verifySubagentSuspicions = async ({
    batch,
    safeId,
    task,
    suspicions,
  }: {
    batch: number
    safeId: string
    task: { id: string; objective: string }
    suspicions: Array<{
      suspicionId: string
      file: string
      startLine: number
      endLine: number
      suspicion: string
    }>
  }) => {
    if (!verificationLayerEnabled) {
      for (const suspicion of suspicions) {
        mainReviewSuspicionIds.add(suspicion.suspicionId)
      }
      return { kind: "disabled" as const, suspicions }
    }

    if (suspicions.length === 0) {
      return {
        kind: "verified" as const,
        approvedFindings: [],
        needsMainReview: [],
        verificationStats: {
          rawSuspicionCount: 0,
          approvedCount: 0,
          rejectedCount: 0,
          droppedLowValueCount: 0,
          escalatedCount: 0,
        },
      }
    }

    const expectedIds = suspicions.map((suspicion) => suspicion.suspicionId)
    const expectedIdSet = new Set(expectedIds)
    const verifierOutputSchema = reviewVerifierOutputSchema.superRefine(
      (output, validation) => {
        const seen = new Set<string>()
        const duplicateIds = new Set<string>()
        const unknownIds = new Set<string>()
        for (const verdict of output.verdicts) {
          if (seen.has(verdict.suspicionId)) {
            duplicateIds.add(verdict.suspicionId)
          }
          seen.add(verdict.suspicionId)
          if (!expectedIdSet.has(verdict.suspicionId)) {
            unknownIds.add(verdict.suspicionId)
          }
        }
        const missingIds = expectedIds.filter((id) => !seen.has(id))
        if (
          output.verdicts.length !== expectedIds.length ||
          missingIds.length > 0 ||
          duplicateIds.size > 0 ||
          unknownIds.size > 0
        ) {
          validation.addIssue({
            code: "custom",
            path: ["verdicts"],
            message: `Invalid verifier verdict ledger. Expected ${expectedIds.length} verdicts. Missing: ${missingIds.join(", ") || "none"}; duplicate: ${[...duplicateIds].join(", ") || "none"}; unknown: ${[...unknownIds].join(", ") || "none"}.`,
          })
        }
      }
    )
    const prompt = buildReviewVerifierPrompt({
      title: pullRequest.title,
      body: pullRequest.body,
      baseRef: pullRequest.baseRef,
      headRef: pullRequest.headRef,
      taskId: task.id,
      taskObjective: task.objective,
      changedLineMap,
      suspicions,
    })
    await recorder.writeText(
      `subagents/batch-${batch}/${safeId}/verification-prompt.txt`,
      prompt
    )

    let lastError: unknown
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const agent = new ToolLoopAgent({
          model: subagentModel,
          instructions: reviewVerifierInstructions,
          tools: createRepositoryTools(
            `verifier.${batch}.${safeId}.${attempt}`
          ),
          providerOptions: verificationProviderOptions,
          output: Output.object({
            schema: verifierOutputSchema,
            name: "verified_review_suspicions",
            description:
              "One strict verifier verdict for every supplied suspicion",
          }),
          stopWhen: stepCountIs(reviewAgentConfig.verification.maxSteps),
          maxRetries: 2,
          onStepFinish: async (step) => recorder.recordStep(step),
        })
        const generation = await agent.generate({ prompt })
        verifierUsages.push(generation.totalUsage)
        await recordBilling("verification", REVIEW_VERIFIER_MODEL, generation)
        const output = verifierOutputSchema.parse(generation.output)
        await recorder.writeJson(
          `subagents/batch-${batch}/${safeId}/verification-attempt-${attempt}.json`,
          {
            finishReason: generation.finishReason,
            usage: generation.totalUsage,
            providerMetadata: generation.providerMetadata,
            output,
            text: generation.text,
          }
        )

        const suspicionsById = new Map(
          suspicions.map((suspicion) => [suspicion.suspicionId, suspicion])
        )
        const approvedFindings: Array<{
          suspicionId: string
          finding: ReturnType<typeof compactFinding>
        }> = []
        const needsMainReview: Array<(typeof suspicions)[number]> = []
        let rejectedCount = 0
        let droppedLowValueCount = 0

        for (const verdict of output.verdicts) {
          const approvalConfidence =
            verdict.verdict === "approved" && verdict.finding
              ? Math.min(verdict.confidence, verdict.finding.confidence)
              : verdict.confidence
          const priorityNeedsMain = shouldEscalatePriority(
            verdict.reviewPriority
          )

          if (
            verdict.verdict === "needs_main_review" ||
            (verdict.verdict === "approved" &&
              approvalConfidence <
                reviewAgentConfig.verification.minApprovedConfidence)
          ) {
            const suspicion = suspicionsById.get(verdict.suspicionId)
            if (suspicion && priorityNeedsMain) {
              mainReviewSuspicionIds.add(verdict.suspicionId)
              verifierDecisions.push({
                suspicionId: verdict.suspicionId,
                decision: "needs_main_review",
                reviewPriority: verdict.reviewPriority,
                confidence: approvalConfidence,
                reason:
                  verdict.verdict === "needs_main_review"
                    ? verdict.reason
                    : `Verifier returned ${verdict.verdict} with confidence ${approvalConfidence}, below the required threshold. ${verdict.reason}`,
                findingIndex: null,
              })
              needsMainReview.push(suspicion)
            } else {
              verifierDecisions.push({
                suspicionId: verdict.suspicionId,
                decision: "dropped_low_value",
                reviewPriority: verdict.reviewPriority,
                confidence: approvalConfidence,
                reason:
                  verdict.verdict === "needs_main_review"
                    ? `Verifier requested main review, but priority ${verdict.reviewPriority} is below the configured main-review threshold. ${verdict.reason}`
                    : `Verifier returned low-confidence approval with priority ${verdict.reviewPriority}, below the configured main-review threshold. ${verdict.reason}`,
                findingIndex: null,
              })
              droppedLowValueCount += 1
            }
            continue
          }

          if (verdict.verdict === "approved" && verdict.finding) {
            const finding = { ...verdict.finding, source: "review" as const }
            const verifierFindingIndex = verifierApprovedFindings.length
            verifierApprovedFindings.push(finding)
            verifierDecisions.push({
              suspicionId: verdict.suspicionId,
              decision: "accepted",
              reviewPriority: verdict.reviewPriority,
              confidence: verdict.confidence,
              reason: verdict.reason,
              findingIndex: verifierFindingIndex,
            })
            approvedFindings.push({
              suspicionId: verdict.suspicionId,
              finding: compactFinding(finding),
            })
            continue
          }
          if (verdict.verdict === "dropped_low_value") {
            verifierDecisions.push({
              suspicionId: verdict.suspicionId,
              decision: "dropped_low_value",
              reviewPriority: verdict.reviewPriority,
              confidence: verdict.confidence,
              reason: verdict.reason,
              findingIndex: null,
            })
            droppedLowValueCount += 1
            continue
          }
          verifierDecisions.push({
            suspicionId: verdict.suspicionId,
            decision: "not_bug",
            reviewPriority: verdict.reviewPriority,
            confidence: verdict.confidence,
            reason: verdict.reason,
            findingIndex: null,
          })
          rejectedCount += 1
        }

        await recorder.appendEvent("subagent.verification.completed", {
          batch,
          taskId: task.id,
          attempt,
          approved: approvedFindings.length,
          needsMainReview: needsMainReview.length,
          rejected: rejectedCount,
          droppedLowValue: droppedLowValueCount,
        })
        return {
          kind: "verified" as const,
          approvedFindings,
          needsMainReview,
          verificationStats: {
            rawSuspicionCount: suspicions.length,
            approvedCount: approvedFindings.length,
            rejectedCount,
            droppedLowValueCount,
            escalatedCount: needsMainReview.length,
          },
        }
      } catch (error) {
        lastError = error
        await recorder.writeJson(
          `subagents/batch-${batch}/${safeId}/verification-attempt-${attempt}-error.json`,
          { error }
        )
        await recorder.appendEvent("subagent.verification.attempt.failed", {
          batch,
          taskId: task.id,
          attempt,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    const reason =
      lastError instanceof Error
        ? `Verifier failed open: ${lastError.message}`
        : "Verifier failed open"
    const escalatedSuspicions = suspicions
      .map((suspicion, index) => ({
        suspicion,
        index,
        score: failedOpenSuspicionScore(suspicion),
      }))
      .sort(
        (first, second) =>
          second.score - first.score || first.index - second.index
      )
      .slice(0, reviewAgentConfig.verification.maxFailedOpenEscalationsPerTask)
      .map((entry) => entry.suspicion)
    const escalatedSuspicionIds = new Set(
      escalatedSuspicions.map((suspicion) => suspicion.suspicionId)
    )
    for (const suspicion of suspicions) {
      if (escalatedSuspicionIds.has(suspicion.suspicionId)) {
        mainReviewSuspicionIds.add(suspicion.suspicionId)
        verifierDecisions.push({
          suspicionId: suspicion.suspicionId,
          decision: "needs_main_review",
          reviewPriority: "high",
          confidence: 0,
          reason,
          findingIndex: null,
        })
      } else {
        verifierDecisions.push({
          suspicionId: suspicion.suspicionId,
          decision: "dropped_low_value",
          reviewPriority: "low",
          confidence: 0,
          reason: `${reason}; not sent to main because failed-open escalation is capped at ${reviewAgentConfig.verification.maxFailedOpenEscalationsPerTask} items per task.`,
          findingIndex: null,
        })
      }
    }
    await recorder.appendEvent("subagent.verification.failed_open", {
      batch,
      taskId: task.id,
      suspicions: suspicions.length,
      escalated: escalatedSuspicions.length,
      droppedLowValue: suspicions.length - escalatedSuspicions.length,
      error: reason,
    })
    return {
      kind: "failed_open" as const,
      error: reason,
      needsMainReview: escalatedSuspicions,
      approvedFindings: [],
      verificationStats: {
        rawSuspicionCount: suspicions.length,
        approvedCount: 0,
        rejectedCount: 0,
        droppedLowValueCount: suspicions.length - escalatedSuspicions.length,
        escalatedCount: escalatedSuspicions.length,
      },
    }
  }
  const spawnReviewAgents = tool({
    description:
      "Run focused review subagents concurrently. Delegate architectural areas and end-to-end flows. May be called repeatedly.",
    inputSchema: z.object({
      tasks: z
        .array(
          z.object({ id: z.string().min(1), objective: z.string().min(1) })
        )
        .min(1)
        .max(8)
        .refine(
          (tasks) =>
            new Set(tasks.map((task) => task.id)).size === tasks.length,
          "Task IDs must be unique within a batch"
        ),
    }),
    execute: async ({ tasks }) => {
      const batch = ++spawnBatch
      await recorder.appendEvent("subagents.batch.started", {
        batch,
        tasks: tasks.map((task) => task.id),
      })
      const runTask = async (task: { id: string; objective: string }) => {
        const safeId = `${String(tasks.indexOf(task) + 1).padStart(2, "0")}-${safePathSegment(task.id)}`
        const prompt = `Assigned exploration:
${task.objective}

Pull request title: ${pullRequest.title}
Pull request description: ${pullRequest.body ?? "(none)"}
Base branch: ${pullRequest.baseRef}
Head branch: ${pullRequest.headRef}

Repository context:
${preparedRepositoryContext.markdown}

Changed files:
${diff}

Changed symbol index:
${affectedSymbols}`
        await recorder.writeText(
          `subagents/batch-${batch}/${safeId}/prompt.txt`,
          prompt
        )
        let lastError: unknown
        for (let attempt = 1; attempt <= 2; attempt += 1) {
          try {
            const agent = new ToolLoopAgent({
              model: subagentModel,
              instructions: reviewSubagentInstructions,
              tools: createRepositoryTools(
                `subagent.${batch}.${safeId}.${attempt}`
              ),
              providerOptions: subagentProviderOptions,
              output: Output.object({
                schema: reviewSubagentOutputSchema,
                name: "review_suspicions",
                description: "Unfiltered suspicious code locations",
              }),
              stopWhen: stepCountIs(reviewAgentConfig.subagent.maxSteps),
              maxRetries: 2,
              onStepFinish: async (step) => recorder.recordStep(step),
            })
            const generation = await agent.generate({ prompt })
            subagentUsages.push(generation.totalUsage)
            await recordBilling("subagents", REVIEW_VERIFIER_MODEL, generation)
            const output = reviewSubagentOutputSchema.parse(generation.output)
            const suspicions = output.suspicions.map((suspicion, index) => {
              const suspicionId = `batch-${batch}:${task.id}:${index + 1}`
              allSuspicionIds.add(suspicionId)
              return { suspicionId, ...suspicion }
            })
            await recorder.writeJson(
              `subagents/batch-${batch}/${safeId}/attempt-${attempt}.json`,
              {
                finishReason: generation.finishReason,
                usage: generation.totalUsage,
                providerMetadata: generation.providerMetadata,
                output,
                text: generation.text,
              }
            )
            await recorder.appendEvent("subagent.completed", {
              batch,
              taskId: task.id,
              attempt,
              suspicions: suspicions.length,
            })
            const verification = await verifySubagentSuspicions({
              batch,
              safeId,
              task,
              suspicions,
            })
            if (verification.kind === "disabled") {
              return { taskId: task.id, suspicions }
            }
            return {
              taskId: task.id,
              approvedFindings: verification.approvedFindings,
              needsMainReview: verification.needsMainReview,
              verificationStats: verification.verificationStats,
              ...(verification.kind === "failed_open"
                ? { verificationError: verification.error }
                : {}),
            }
          } catch (error) {
            lastError = error
            await recorder.writeJson(
              `subagents/batch-${batch}/${safeId}/attempt-${attempt}-error.json`,
              { error }
            )
            await recorder.appendEvent("subagent.attempt.failed", {
              batch,
              taskId: task.id,
              attempt,
              error: error instanceof Error ? error.message : String(error),
            })
          }
        }
        return {
          taskId: task.id,
          error:
            lastError instanceof Error
              ? lastError.message
              : "Subagent failed after retry",
        }
      }
      const results: Awaited<ReturnType<typeof runTask>>[] = []
      for (let offset = 0; offset < tasks.length; offset += 4) {
        results.push(
          ...(await Promise.all(tasks.slice(offset, offset + 4).map(runTask)))
        )
      }
      const completed = results.filter((item) => !("error" in item))
      const failures = results.filter((item) => "error" in item)
      const output = {
        results: completed,
        failures,
      }
      await recorder.writeJson(`subagents/batch-${batch}/result.json`, output)
      await recorder.recordToolCall({
        name: "main.spawn_review_agents",
        input: { tasks },
        output,
      })
      await recorder.appendEvent("subagents.batch.completed", {
        batch,
        completed: output.results.length,
        failed: output.failures.length,
      })
      return output
    },
  })

  const runNaturalLanguageLinter = async (): Promise<
    ReviewReport["findings"]
  > => {
    const rules = reviewConfig.naturalLanguageRules
    if (rules.length === 0 || filteredFiles.length === 0) {
      return []
    }

    logger.info("Review agent stage started", {
      ...context,
      stage: "natural-language-linter",
      rules: rules.length,
      files: filteredFiles.length,
    })
    await recorder.appendEvent("stage.started", {
      stage: "natural-language-linter",
      rules: rules.length,
      files: filteredFiles.length,
    })

    const batches = batchNaturalLanguageLinterFiles(filteredFiles)
    await recorder.writeJson("natural-language-linter/batches.json", {
      rules,
      batches: batches.map((batch) => batch.map((file) => file.filename)),
    })

    const runBatch = async (batch: PullRequestFile[], index: number) => {
      const batchId = String(index + 1).padStart(2, "0")
      const assignedFiles = batch.map((file) => file.filename)
      const fileContext = (
        await Promise.all(
          assignedFiles.map(async (file) => {
            const lines = changedLinesByFile.get(file) ?? []
            if (lines.length === 0) return `## ${file}\nNo changed head lines.`
            const startLine = Math.max(1, Math.min(...lines) - 8)
            const maxLines = Math.min(180, Math.max(...lines) - startLine + 9)
            try {
              const excerpt = await readRepositoryFile({
                repository: runtime.paths.repositoryPath,
                file,
                startLine,
                maxLines,
              })
              return `## ${file}\nChanged head lines: ${lines.join(", ")}\n\n${excerpt.content}`
            } catch (error) {
              const message =
                error instanceof Error ? error.message : "Could not read file."
              return `## ${file}\nChanged head lines: ${lines.join(", ")}\nCould not read numbered excerpt: ${message}`
            }
          })
        )
      ).join("\n\n")
      const prompt = buildNaturalLanguageLinterPrompt({
        rules,
        diff: serializePullRequestFiles(batch),
        fileContext,
      })
      await recorder.writeText(
        `natural-language-linter/batch-${batchId}/prompt.txt`,
        prompt
      )

      const agent = new ToolLoopAgent({
        model: subagentModel,
        instructions: naturalLanguageLinterInstructions,
        tools: {},
        providerOptions: subagentProviderOptions,
        output: Output.object({
          schema: naturalLanguageLinterOutputSchema,
          name: "natural_language_linter_findings",
          description:
            "Natural-language rule findings grouped by assigned file",
        }),
        stopWhen: stepCountIs(reviewAgentConfig.naturalLanguageLinter.maxSteps),
        maxRetries: 2,
        onStepFinish: async (step) => recorder.recordStep(step),
      })
      const generation = await agent.generate({ prompt })
      linterUsages.push(generation.totalUsage)
      await recordBilling(
        "natural_language_linter",
        REVIEW_VERIFIER_MODEL,
        generation
      )

      const output = naturalLanguageLinterOutputSchema.parse(generation.output)
      const outputByFile = new Map<string, (typeof output.files)[number]>()
      const duplicateFiles = new Set<string>()
      for (const file of output.files) {
        if (outputByFile.has(file.file)) {
          duplicateFiles.add(file.file)
          continue
        }
        outputByFile.set(file.file, file)
      }
      const missingFiles = assignedFiles.filter(
        (file) => !outputByFile.has(file)
      )
      const extraFiles = output.files
        .map((file) => file.file)
        .filter((file) => !assignedFiles.includes(file))
      await recorder.writeJson(
        `natural-language-linter/batch-${batchId}/output.json`,
        {
          assignedFiles,
          coverage: {
            missingFiles,
            extraFiles,
            duplicateFiles: [...duplicateFiles],
          },
          finishReason: generation.finishReason,
          usage: generation.totalUsage,
          providerMetadata: generation.providerMetadata,
          output,
          text: generation.text,
        }
      )

      const validRuleIndexes = new Set(rules.map((_, ruleIndex) => ruleIndex))
      return assignedFiles.flatMap((assignedFile) => {
        const file = outputByFile.get(assignedFile)
        if (!file) return []
        return file.findings
          .filter((finding) => validRuleIndexes.has(finding.ruleIndex))
          .map((finding) => ({
            severity: "low" as const,
            source: "natural_language_linter" as const,
            file: file.file,
            startLine: finding.startLine,
            endLine: finding.endLine,
            title: finding.title,
            body: `Rule: ${rules[finding.ruleIndex]}\n\n${finding.body}`,
            confidence: finding.confidence,
          }))
      })
    }

    const findings: ReviewReport["findings"] = []
    for (let offset = 0; offset < batches.length; offset += 4) {
      findings.push(
        ...(
          await Promise.all(
            batches
              .slice(offset, offset + 4)
              .map((batch, index) => runBatch(batch, offset + index))
          )
        ).flat()
      )
    }

    await recorder.writeJson("natural-language-linter/findings.json", findings)
    logger.info("Review agent stage completed", {
      ...context,
      stage: "natural-language-linter",
      batches: batches.length,
      findings: findings.length,
    })
    await recorder.appendEvent("stage.completed", {
      stage: "natural-language-linter",
      batches: batches.length,
      findings: findings.length,
    })
    return findings
  }

  const mainPrompt = buildMainReviewPrompt({
    title: pullRequest.title,
    body: pullRequest.body,
    baseRef: pullRequest.baseRef,
    headRef: pullRequest.headRef,
    diff,
    affectedSymbols,
    repositoryContext: preparedRepositoryContext.markdown,
  })
  const mainInstructions = verificationLayerEnabled
    ? mainReviewAgentWithVerificationInstructions
    : mainReviewAgentInstructions
  await recorder.writeText(
    "context/main-review-instructions.txt",
    mainInstructions
  )
  await recorder.writeText("context/main-review-prompt.txt", mainPrompt)
  await recorder.writeJson("context/main-review-prompt-stats.json", {
    promptBytes: textBytes(mainPrompt),
    diffBytes: textBytes(diff),
    affectedSymbolsBytes: textBytes(affectedSymbols),
    repositoryContextBytes: textBytes(preparedRepositoryContext.markdown),
    repositoryContextSource: preparedRepositoryContext.source,
    semanticEnabled,
    verificationLayerEnabled,
  })
  const mainOutputSchema = reviewReportSchema
    .extend({
      decisions: z.array(reviewSuspicionDecisionSchema),
    })
    .superRefine((output, validation) => {
      const seen = new Set<string>()
      const duplicateIds = new Set<string>()
      const unknownIds = new Set<string>()
      for (const decision of output.decisions) {
        if (seen.has(decision.suspicionId)) {
          duplicateIds.add(decision.suspicionId)
        }
        seen.add(decision.suspicionId)
        if (!mainReviewSuspicionIds.has(decision.suspicionId)) {
          unknownIds.add(decision.suspicionId)
        }
        if (
          decision.decision === "accepted" &&
          (decision.findingIndex === null ||
            decision.findingIndex >= output.findings.length)
        ) {
          validation.addIssue({
            code: "custom",
            path: ["decisions"],
            message: `Accepted suspicion ${decision.suspicionId} must reference an existing findingIndex.`,
          })
        }
        if (
          decision.decision !== "accepted" &&
          decision.findingIndex !== null
        ) {
          validation.addIssue({
            code: "custom",
            path: ["decisions"],
            message: `Rejected suspicion ${decision.suspicionId} must set findingIndex to null.`,
          })
        }
      }
      const missingIds = [...mainReviewSuspicionIds].filter(
        (id) => !seen.has(id)
      )
      if (
        missingIds.length > 0 ||
        duplicateIds.size > 0 ||
        unknownIds.size > 0
      ) {
        validation.addIssue({
          code: "custom",
          path: ["decisions"],
          message: `Invalid suspicion decision ledger. Missing: ${missingIds.join(", ") || "none"}; duplicate: ${[...duplicateIds].join(", ") || "none"}; unknown: ${[...unknownIds].join(", ") || "none"}.`,
        })
      }
    })
  const mainAgent = new ToolLoopAgent({
    model: mainModel,
    instructions: mainInstructions,
    tools: {
      ...createRepositoryTools("main"),
      spawn_review_agents: spawnReviewAgents,
    },
    providerOptions: mainProviderOptions,
    output: Output.object({
      schema: mainOutputSchema,
      name: "review_report",
      description:
        "Verified pull request review and a complete decision ledger for delegated suspicions requiring main review",
    }),
    stopWhen: stepCountIs(reviewAgentConfig.main.maxSteps),
    maxRetries: 2,
    onStepFinish: async (step) => recorder.recordStep(step),
  })
  const mainGeneration = await mainAgent.generate({ prompt: mainPrompt })
  const mainUsage = await recordBilling("main", REVIEW_MODEL, mainGeneration)
  const mainOutput = mainOutputSchema.parse(mainGeneration.output)
  const generatedReport = reviewReportSchema.parse(mainOutput)
  const linterFindings = await runNaturalLanguageLinter()
  const candidateReport: ReviewReport = {
    ...generatedReport,
    findings: [
      ...verifierApprovedFindings,
      ...generatedReport.findings,
      ...linterFindings,
    ],
  }
  const mainDecisionById = new Map(
    mainOutput.decisions.map((decision) => [decision.suspicionId, decision])
  )
  const combinedSuspicionDecisions = verificationLayerEnabled
    ? verifierDecisions.map((verifierDecision) => {
        if (verifierDecision.decision !== "needs_main_review") {
          return {
            ...verifierDecision,
            reviewedBy: "verifier" as const,
          }
        }
        const mainDecision = mainDecisionById.get(verifierDecision.suspicionId)
        return mainDecision
          ? {
              ...mainDecision,
              findingIndex:
                mainDecision.findingIndex === null
                  ? null
                  : mainDecision.findingIndex + verifierApprovedFindings.length,
              reviewedBy: "main" as const,
              verifierReason: verifierDecision.reason,
            }
          : {
              suspicionId: verifierDecision.suspicionId,
              decision: "not_bug" as const,
              reason: `Verifier escalated but main decision was missing: ${verifierDecision.reason}`,
              findingIndex: null,
              reviewedBy: "main" as const,
              verifierReason: verifierDecision.reason,
            }
      })
    : mainOutput.decisions.map((decision) => ({
        ...decision,
        reviewedBy: "main" as const,
      }))
  await recorder.writeJson("main-agent-output.json", {
    finishReason: mainGeneration.finishReason,
    usage: mainGeneration.totalUsage,
    providerMetadata: mainGeneration.providerMetadata,
    output: mainOutput,
    text: mainGeneration.text,
  })
  await recorder.writeJson("main-suspicion-decisions.json", mainOutput.decisions)
  await recorder.writeJson("verifier-suspicion-decisions.json", {
    enabled: verificationLayerEnabled,
    decisions: verifierDecisions,
  })
  await recorder.writeJson(
    "suspicion-decisions.json",
    combinedSuspicionDecisions
  )
  const decisionCounts = {
    accepted: combinedSuspicionDecisions.filter(
      (decision) => decision.decision === "accepted"
    ).length,
    duplicate: combinedSuspicionDecisions.filter(
      (decision) => decision.decision === "duplicate"
    ).length,
    notBug: combinedSuspicionDecisions.filter(
      (decision) => decision.decision === "not_bug"
    ).length,
    droppedLowValue: combinedSuspicionDecisions.filter(
      (decision) => decision.decision === "dropped_low_value"
    ).length,
    needsMainReview: verifierDecisions.filter(
      (decision) => decision.decision === "needs_main_review"
    ).length,
    verifierAccepted: verifierDecisions.filter(
      (decision) => decision.decision === "accepted"
    ).length,
    verifierRejected: verifierDecisions.filter(
      (decision) => decision.decision === "not_bug"
    ).length,
    verifierDroppedLowValue: verifierDecisions.filter(
      (decision) => decision.decision === "dropped_low_value"
    ).length,
  }

  const reportValidation = await validateReviewReportEvidence({
    repository: runtime.paths.repositoryPath,
    diffFiles: parsedDiffFiles,
    report: candidateReport,
  })
  const invalidEvidenceFindings = candidateReport.findings.filter(
    (_, index) => !reportValidation.findings[index]?.valid
  )
  const evidenceRepairedFindings = reportValidation.findings.filter(
    (finding) => finding.status === "repairable"
  )
  const generatedFindingCount =
    verifierApprovedFindings.length + generatedReport.findings.length
  const validCandidateEntries = candidateReport.findings
    .map((finding, index) => ({ finding, index }))
    .filter((entry) => reportValidation.findings[entry.index]?.valid)
    .map((entry) => {
      const normalized = reportValidation.findings[entry.index]?.normalized
      return {
        ...entry,
        finding: normalized
          ? {
              ...entry.finding,
              file: normalized.file,
              startLine: normalized.startLine,
              endLine: normalized.endLine,
            }
          : entry.finding,
      }
    })
  const validMainFindings = validCandidateEntries
    .filter((entry) => entry.index < generatedFindingCount)
    .map((entry, order) => ({ finding: entry.finding, order }))
  const validLinterFindings = validCandidateEntries
    .filter((entry) => entry.index >= generatedFindingCount)
    .map((entry) => entry.finding)
  const meaningfulTokens = (text: string) =>
    new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .split(/\s+/)
        .filter((token) => token.length > 2)
        .map((token) =>
          token.length > 3 && token.endsWith("s") ? token.slice(0, -1) : token
        )
    )
  const overlap = (
    first: ReviewReport["findings"][number],
    second: ReviewReport["findings"][number]
  ) =>
    first.file === second.file &&
    first.startLine <= second.endLine &&
    second.startLine <= first.endLine
  const tokenOverlapScore = (first: Set<string>, second: Set<string>) => {
    if (first.size === 0 || second.size === 0) return 0
    const shared = [...first].filter((token) => second.has(token)).length
    return shared / Math.min(first.size, second.size)
  }
  const tokensForFinding = (finding: ReviewReport["findings"][number]) =>
    new Set([
      ...meaningfulTokens(finding.title),
      ...meaningfulTokens(finding.body),
    ])
  const shouldDropLinterFinding = (
    linterFinding: ReviewReport["findings"][number]
  ) => {
    const linterTokens = tokensForFinding(linterFinding)
    return validMainFindings.some(({ finding }) => {
      if (!overlap(linterFinding, finding)) return false
      return tokenOverlapScore(linterTokens, tokensForFinding(finding)) >= 0.7
    })
  }
  const runFindingDeduplication = async (
    findings: ReviewReport["findings"]
  ) => {
    if (!verificationLayerEnabled || findings.length <= 1) {
      return {
        duplicateIndexes: new Set<number>(),
        duplicateGroups: [],
      }
    }

    const validIndexes = new Set(findings.map((_, index) => index))
    const deduplicationOutputSchema =
      reviewFindingDeduplicationOutputSchema.superRefine(
        (output, validation) => {
          const duplicateIndexes = new Set<number>()
          for (const [groupIndex, group] of output.duplicateGroups.entries()) {
            if (!validIndexes.has(group.keepIndex)) {
              validation.addIssue({
                code: "custom",
                path: ["duplicateGroups", groupIndex, "keepIndex"],
                message: `keepIndex ${group.keepIndex} is not a valid finding index.`,
              })
            }
            for (const duplicateIndex of group.duplicateIndexes) {
              if (!validIndexes.has(duplicateIndex)) {
                validation.addIssue({
                  code: "custom",
                  path: ["duplicateGroups", groupIndex, "duplicateIndexes"],
                  message: `duplicateIndex ${duplicateIndex} is not a valid finding index.`,
                })
              }
              if (duplicateIndex === group.keepIndex) {
                validation.addIssue({
                  code: "custom",
                  path: ["duplicateGroups", groupIndex, "duplicateIndexes"],
                  message: "duplicateIndexes must not include keepIndex.",
                })
              }
              if (duplicateIndexes.has(duplicateIndex)) {
                validation.addIssue({
                  code: "custom",
                  path: ["duplicateGroups", groupIndex, "duplicateIndexes"],
                  message: `duplicateIndex ${duplicateIndex} appears in multiple duplicate groups.`,
                })
              }
              duplicateIndexes.add(duplicateIndex)
            }
          }
        }
      )
    const prompt = buildReviewFindingDeduplicationPrompt({
      findings: findings.map((finding, index) => ({
        index,
        severity: finding.severity,
        file: finding.file,
        startLine: finding.startLine,
        endLine: finding.endLine,
        title: finding.title,
        body: finding.body,
        confidence: finding.confidence,
      })),
    })
    await recorder.writeText("deduplication/prompt.txt", prompt)

    try {
      const agent = new ToolLoopAgent({
        model: subagentModel,
        instructions: reviewFindingDeduplicationInstructions,
        tools: {},
        providerOptions: verificationProviderOptions,
        output: Output.object({
          schema: deduplicationOutputSchema,
          name: "review_finding_duplicates",
          description:
            "Exact duplicate finding groups where only duplicate indexes should be removed",
        }),
        stopWhen: stepCountIs(reviewAgentConfig.deduplication.maxSteps),
        maxRetries: 2,
        onStepFinish: async (step) => recorder.recordStep(step),
      })
      const generation = await agent.generate({ prompt })
      deduplicationUsages.push(generation.totalUsage)
      await recordBilling("deduplication", REVIEW_VERIFIER_MODEL, generation)
      const output = deduplicationOutputSchema.parse(generation.output)
      const duplicateIndexes = new Set(
        output.duplicateGroups.flatMap((group) => group.duplicateIndexes)
      )
      await recorder.writeJson("deduplication/output.json", {
        finishReason: generation.finishReason,
        usage: generation.totalUsage,
        providerMetadata: generation.providerMetadata,
        output,
        text: generation.text,
        duplicateIndexes: [...duplicateIndexes],
      })
      await recorder.appendEvent("deduplication.completed", {
        findings: findings.length,
        duplicateGroups: output.duplicateGroups.length,
        duplicateFindings: duplicateIndexes.size,
      })
      return {
        duplicateIndexes,
        duplicateGroups: output.duplicateGroups,
      }
    } catch (error) {
      await recorder.writeJson("deduplication/error.json", { error })
      await recorder.appendEvent("deduplication.failed_open", {
        findings: findings.length,
        error: error instanceof Error ? error.message : String(error),
      })
      return {
        duplicateIndexes: new Set<number>(),
        duplicateGroups: [],
      }
    }
  }
  const severityRank = { critical: 0, high: 1, medium: 2, low: 3 }
  const preDeduplicationFindings = [
    ...validMainFindings
      .sort(
        (first, second) =>
          severityRank[first.finding.severity] -
            severityRank[second.finding.severity] ||
          first.order - second.order
      )
      .map((entry) => entry.finding),
    ...validLinterFindings.filter(
      (finding) => !shouldDropLinterFinding(finding)
    ),
  ]
  const findingDeduplication = await runFindingDeduplication(
    preDeduplicationFindings
  )
  const finalFindings = preDeduplicationFindings.filter(
    (_, index) => !findingDeduplication.duplicateIndexes.has(index)
  )
  const finalReport: ReviewReport = {
    ...candidateReport,
    ...(finalFindings.length === 0 && candidateReport.findings.length > 0
      ? {
          mergeSafetyScore: 5 as const,
          mergeSafetyReason:
            "No candidate findings had locatable evidence after validation; merge-safety is based on the absence of retained validated findings.",
        }
      : invalidEvidenceFindings.length > 0
        ? {
            mergeSafetyReason: `Merge-safety is based on ${finalFindings.length} retained validated finding(s). ${invalidEvidenceFindings.length} candidate finding(s) were omitted because their evidence could not be anchored; the final finding list below is authoritative.`,
          }
        : {}),
    findings: finalFindings,
  }
  await recorder.writeJson("deduplication/final.json", {
    enabled: verificationLayerEnabled,
    inputFindings: preDeduplicationFindings,
    duplicateGroups: findingDeduplication.duplicateGroups,
    duplicateIndexes: [...findingDeduplication.duplicateIndexes],
    outputFindings: finalReport.findings,
  })
  await recorder.writeJson(
    "candidate-review-report-validation.json",
    reportValidation
  )
  await recorder.writeJson(
    "evidence-filtered-findings.json",
    invalidEvidenceFindings
  )
  await recorder.writeJson(
    "evidence-repaired-findings.json",
    evidenceRepairedFindings
  )
  await recorder.writeJson("review-report.json", finalReport)
  const renderedReport = renderReviewSummaryComment({
    report: finalReport,
    inlineReview: { kind: "not_needed" },
  })
  await recorder.writeText("rendered-comment.md", renderedReport)
  const generationUsage = {
    main: mainUsage,
    subagents: subagentUsages,
    verification: verifierUsages,
    deduplication: deduplicationUsages,
    naturalLanguageLinter: linterUsages,
  }
  logger.info("Review agent stage completed", {
    ...context,
    stage: "generation",
    usage: generationUsage,
    spawnBatches: spawnBatch,
    verificationLayerEnabled,
    rawSuspicionCount: allSuspicionIds.size,
    mainReviewSuspicionCount: mainReviewSuspicionIds.size,
    duplicateFindingsRemoved: findingDeduplication.duplicateIndexes.size,
    suspicionDecisions: decisionCounts,
    mergeSafetyScore: finalReport.mergeSafetyScore,
    findings: finalReport.findings.length,
    generatedFindings: generatedReport.findings.length,
    verifierApprovedFindings: verifierApprovedFindings.length,
    naturalLanguageLinterFindings: linterFindings.length,
    evidenceFilteredFindings: invalidEvidenceFindings.length,
    evidenceRepairedFindings: evidenceRepairedFindings.length,
  })
  await recorder.appendEvent("stage.completed", {
    stage: "generation",
    usage: generationUsage,
    spawnBatches: spawnBatch,
    verificationLayerEnabled,
    rawSuspicionCount: allSuspicionIds.size,
    mainReviewSuspicionCount: mainReviewSuspicionIds.size,
    duplicateFindingsRemoved: findingDeduplication.duplicateIndexes.size,
    suspicionDecisions: decisionCounts,
    mergeSafetyScore: finalReport.mergeSafetyScore,
    findings: finalReport.findings.length,
    generatedFindings: generatedReport.findings.length,
    verifierApprovedFindings: verifierApprovedFindings.length,
    naturalLanguageLinterFindings: linterFindings.length,
    evidenceFilteredFindings: invalidEvidenceFindings.length,
    evidenceRepairedFindings: evidenceRepairedFindings.length,
  })

  logger.info("Review agent stage started", { ...context, stage: "publish" })
  await recorder.appendEvent("stage.started", { stage: "publish" })
  let publishedReport = renderedReport
  await updateReviewComment({
    repo: repository,
    installationId,
    commentId,
    pullRequestId: pullRequest.id,
    reviewRunId: reviewCommentRunId,
    body: publishedReport,
  })
  let reviewId: number | undefined
  let reviewEvent: PullRequestReviewEvent | undefined
  let inlineCommentCount: number | undefined
  let inlineReviewPublishError: string | undefined
  if (finalReport.findings.length > 0) {
    type PublishedInlineReview = {
      reviewId: number
      inlineCommentCount: number
      event: PullRequestReviewEvent
    }
    const inlineReviews: PublishedInlineReview[] = []
    try {
      const bugFindings = finalReport.findings.filter(
        (finding) => finding.source !== "natural_language_linter"
      )
      const lintFindings = finalReport.findings.filter(
        (finding) => finding.source === "natural_language_linter"
      )

      if (bugFindings.length > 0) {
        const bugReview = await publishPullRequestReview({
          repo: repository,
          installationId,
          pullRequestNumber: pullRequest.number,
          headSha: pullRequest.headSha,
          findings: bugFindings,
        })
        if (bugReview) inlineReviews.push(bugReview)
      }

      if (lintFindings.length > 0) {
        const lintReview = await publishPullRequestReview({
          repo: repository,
          installationId,
          pullRequestNumber: pullRequest.number,
          headSha: pullRequest.headSha,
          findings: lintFindings,
          body: "Linting rule violations from configured natural-language rules:",
        })
        if (lintReview) inlineReviews.push(lintReview)
      }
    } catch (error) {
      inlineReviewPublishError =
        error instanceof Error
          ? error.message
          : "Unknown inline review publish error"
      logger.error("Failed to publish inline pull request review", {
        ...context,
        stage: "publish",
        commentId,
        error,
      })
      await recorder.writeJson("inline-review-error.json", {
        message: inlineReviewPublishError,
        error,
      })
      await recorder.appendEvent("inline_review.failed", {
        message: inlineReviewPublishError,
        findings: finalReport.findings.length,
        publishedInlineReviewCount: inlineReviews.length,
        publishedInlineCommentCount: inlineReviews.reduce(
          (total, review) => total + review.inlineCommentCount,
          0
        ),
      })
      publishedReport = renderReviewSummaryComment({
        report: finalReport,
        inlineReview: {
          kind: "failed",
          error: inlineReviewPublishError,
        },
      })
      try {
        await updateReviewComment({
          repo: repository,
          installationId,
          commentId,
          pullRequestId: pullRequest.id,
          reviewRunId: reviewCommentRunId,
          body: publishedReport,
        })
      } catch (fallbackError) {
        logger.error("Failed to publish inline review fallback summary", {
          ...context,
          stage: "publish",
          commentId,
          error: fallbackError,
        })
      }
    }
    const lastInlineReview = inlineReviews.at(-1)
    const inlineReview = lastInlineReview
      ? {
          reviewId: lastInlineReview.reviewId,
          event: lastInlineReview.event,
          inlineCommentCount: inlineReviews.reduce(
            (total, review) => total + review.inlineCommentCount,
            0
          ),
        }
      : null
    if (inlineReview) {
      reviewId = inlineReview.reviewId
      reviewEvent = inlineReview.event
      inlineCommentCount = inlineReview.inlineCommentCount
    }
  }
  const llmCostMicrocents = Object.values(llmBilling).reduce<number>(
    (total, value) => {
      if (
        typeof value === "object" &&
        value !== null &&
        "costMicrocents" in value &&
        typeof (value as { costMicrocents?: unknown }).costMicrocents ===
          "number"
      ) {
        return total + (value as { costMicrocents: number }).costMicrocents
      }
      return total
    },
    0
  )
  const vectorWriteCostMicrocents = semanticEnabled
    ? calculateVectorWriteCostMicrocents(qdrantLogicalWriteBytes)
    : 0
  const vectorQueryCostMicrocents = semanticEnabled
    ? calculateVectorQueryCostMicrocents(vectorQueryBytes)
    : 0
  const vectorNetworkCostMicrocents = semanticEnabled
    ? calculateVectorNetworkCostMicrocents(vectorNetworkBytes)
    : 0
  const billing = {
    billingUnit: "micro_usd" as const,
    llmCostMicroUsd: llmCostMicrocents,
    llmCostMicrocents,
    vectorWriteBytes: qdrantLogicalWriteBytes,
    vectorQueryBytes,
    vectorNetworkBytes,
    vectorQueryCount,
    vectorWriteCostMicroUsd: vectorWriteCostMicrocents,
    vectorWriteCostMicrocents,
    vectorQueryCostMicroUsd: vectorQueryCostMicrocents,
    vectorQueryCostMicrocents,
    vectorNetworkCostMicroUsd: vectorNetworkCostMicrocents,
    vectorNetworkCostMicrocents,
    totalCostMicroUsd:
      llmCostMicrocents +
      vectorWriteCostMicrocents +
      vectorQueryCostMicrocents +
      vectorNetworkCostMicrocents,
    totalCostMicrocents:
      llmCostMicrocents +
      vectorWriteCostMicrocents +
      vectorQueryCostMicrocents +
      vectorNetworkCostMicrocents,
    llm: llmBilling,
  }
  const result = {
    kind: "summary" as const,
    summary: publishedReport,
    triggerSource,
    modelId: REVIEW_MODEL,
    verifierModelId: REVIEW_VERIFIER_MODEL,
    fetchedFileCount,
    filteredFileCount: filteredFiles.length,
    diffChangedLineCount,
    commentId,
    reviewId,
    reviewEvent,
    inlineCommentCount,
    inlineReviewPublishError,
    mergeSafetyScore: finalReport.mergeSafetyScore,
    findings: finalReport.findings,
    verificationLayerEnabled,
    rawSuspicionCount: allSuspicionIds.size,
    mainReviewSuspicionCount: mainReviewSuspicionIds.size,
    duplicateFindingsRemoved: findingDeduplication.duplicateIndexes.size,
    suspicionDecisions: decisionCounts,
    usage: generationUsage as unknown as Record<string, unknown>,
    billing,
    startedAt: startedAtIso,
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
  }
  await recorder.writeJson("result.json", result)
  await recorder.writeJson("summary.json", {
    status: "completed",
    reviewRunId,
    repository: repository.fullName,
    pullRequestNumber: pullRequest.number,
    modelId: REVIEW_MODEL,
    verifierModelId: REVIEW_VERIFIER_MODEL,
    fetchedFileCount,
    filteredFileCount: filteredFiles.length,
    diffChangedLineCount,
    verificationLayerEnabled,
    rawSuspicionCount: allSuspicionIds.size,
    mainReviewSuspicionCount: mainReviewSuspicionIds.size,
    duplicateFindingsRemoved: findingDeduplication.duplicateIndexes.size,
    semanticEnabled,
    qdrantEnabled: semanticEnabled,
    qdrantChunks,
    qdrantIndexedFiles,
    qdrantIgnoredFiles,
    qdrantLogicalWriteBytes,
    generatedFindings: generatedReport.findings.length,
    verifierApprovedFindings: verifierApprovedFindings.length,
    naturalLanguageLinterFindings: linterFindings.length,
    evidenceFilteredFindings: invalidEvidenceFindings.length,
    evidenceRepairedFindings: evidenceRepairedFindings.length,
    suspicionDecisions: decisionCounts,
    confirmedFindings: finalReport.findings.length,
    inlineCommentCount,
    reviewId,
    reviewEvent,
    inlineReviewPublishError,
    mergeSafetyScore: finalReport.mergeSafetyScore,
    usage: result.usage,
    billing,
    counts: recorder.counts(),
    durationMs: result.durationMs,
  })
  await recorder.writeText("published-comment.md", publishedReport)
  logger.info("Review agent stage completed", {
    ...context,
    stage: "publish",
    commentId,
    reviewId,
    reviewEvent,
    inlineCommentCount,
    inlineReviewPublishError,
    durationMs: result.durationMs,
  })
  await recorder.appendEvent("stage.completed", {
    stage: "publish",
    commentId,
    reviewId,
    reviewEvent,
    inlineCommentCount,
    inlineReviewPublishError,
    durationMs: result.durationMs,
  })
  await recorder.appendEvent("review.completed", result)
  return result
}

export const publishReviewFailure = async ({
  pullRequest,
  repository,
  installationId,
  reviewRunId,
  triggerSource,
}: Pick<
  RunInput,
  | "pullRequest"
  | "repository"
  | "installationId"
  | "reviewRunId"
  | "triggerSource"
>) => {
  const reviewCommentRunId =
    triggerSource === "mention" ? reviewRunId : undefined
  const commentId = await findOrCreateReviewComment({
    repo: repository,
    installationId,
    pullRequestNumber: pullRequest.number,
    pullRequestId: pullRequest.id,
    reviewRunId: reviewCommentRunId,
  })
  await updateReviewComment({
    repo: repository,
    installationId,
    commentId,
    pullRequestId: pullRequest.id,
    reviewRunId: reviewCommentRunId,
    body: reviewFailedBody,
  })
  return commentId
}
