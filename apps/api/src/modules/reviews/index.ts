import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import { createGateway, Output, ToolLoopAgent, tool } from "ai"
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
  annotatePullRequestFilesForReview,
  batchNaturalLanguageLinterFiles,
  countPullRequestChangedLines,
  filterPullRequestFiles,
  getDiffSkipReason,
  serializePullRequestFilesAsUnifiedDiff,
  serializePullRequestFiles,
} from "./diff"
import {
  findOrCreateReviewComment,
  listPullRequestFiles,
  publishPullRequestReview,
  type PullRequestReviewEvent,
  reviewFailedBody,
  updateReviewComment,
} from "./github"
import { validateReviewReportEvidence } from "./evidence"
import {
  buildMainReviewPrompt,
  buildNaturalLanguageLinterPrompt,
  mainReviewAgentInstructions,
  naturalLanguageLinterInstructions,
  naturalLanguageLinterOutputSchema,
  renderAffectedSymbols,
  renderReviewSummaryComment,
  renderSemanticCoverage,
  reviewReportSchema,
  reviewSubagentInstructions,
  reviewSubagentOutputSchema,
  reviewSuspicionDecisionSchema,
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

type Logger = {
  info: (message: string, details?: Record<string, unknown>) => void
  error: (message: string, details?: Record<string, unknown>) => void
}

type RunInput = {
  reviewRunId: string
  pullRequest: typeof pullRequest.$inferSelect
  repository: typeof repository.$inferSelect
  reviewConfig: ReviewConfigValues
  installationId: string
  triggerSource: string
  logger: Logger
}

export type ReviewAgentResult = {
  kind: "summary" | "skipped"
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
  skipReason?: string
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

const recordLlmBilling = async (
  stages: Record<string, unknown>,
  stage: string,
  modelId: string,
  generation: unknown,
  provider: "openrouter" | "gateway",
  resolveGenerationCost: typeof resolveOpenRouterGenerationCost
) => {
  const cost = await resolveGenerationCost(generation)
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
  if (
    costIsPartial &&
    (provider !== "gateway" || resolvedStepCostMicrocents <= 0)
  ) {
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
    throw new Error(
      `${provider} cost is missing for ${stage}${detail ? ` (${detail})` : ""}`
    )
  }
  const recordedCostUsd = costIsPartial ? resolvedStepCostUsd : cost.cost
  const recordedCostMicrocents = costIsPartial
    ? resolvedStepCostMicrocents
    : cost.costMicrocents
  const usage =
    typeof generation === "object" &&
    generation !== null &&
    "totalUsage" in generation
      ? (generation as { totalUsage: unknown }).totalUsage
      : undefined
  const entry = {
    modelId,
    provider,
    usage,
    billingUnit: "micro_usd",
    costUsd: recordedCostUsd,
    costMicroUsd: recordedCostMicrocents,
    costMicrocents: recordedCostMicrocents,
    ...(costIsPartial ? { costStatus: "partial" } : {}),
    steps: cost.steps,
    stepCount: cost.steps.length,
    providerMetadata:
      typeof generation === "object" &&
      generation !== null &&
      "providerMetadata" in generation
        ? (generation as { providerMetadata: unknown }).providerMetadata
        : undefined,
  }
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
      stepCount?: number
      steps?: unknown[]
      calls?: unknown[]
    }
    stages[stage] = {
      ...existingEntry,
      costUsd: (existingEntry.costUsd ?? 0) + recordedCostUsd,
      costMicroUsd: existingEntry.costMicroUsd + recordedCostMicrocents,
      costMicrocents:
        existingEntry.costMicrocents + recordedCostMicrocents,
      ...(costIsPartial || existingEntry.costStatus === "partial"
        ? { costStatus: "partial" }
        : {}),
      steps: [...(existingEntry.steps ?? []), ...cost.steps],
      stepCount: (existingEntry.stepCount ?? 0) + cost.steps.length,
      calls: [...(existingEntry.calls ?? []), entry],
    }
  } else {
    stages[stage] = { ...entry, calls: [entry] }
  }
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
  const files = await listPullRequestFiles({
    repo: repository,
    installationId,
    pullRequestNumber: pullRequest.number,
  })
  const filteredFiles = filterPullRequestFiles(
    files,
    reviewConfig.pathIncludePatterns,
    reviewConfig.pathExcludePatterns
  )
  const visibleFiles = annotatePullRequestFilesForReview(
    files,
    reviewConfig.pathIncludePatterns,
    reviewConfig.pathExcludePatterns
  )
  const omittedFiles = visibleFiles.filter((file) => file.omittedReason)
  const diff = serializePullRequestFiles(visibleFiles)
  const unifiedDiff = serializePullRequestFilesAsUnifiedDiff(filteredFiles)
  const diffChangedLineCount = countPullRequestChangedLines(filteredFiles)
  await recorder.writeJson("review-config.json", reviewConfig)
  await recorder.writeJson("github-files.json", files)
  await recorder.writeJson("filtered-files.json", filteredFiles)
  await recorder.writeJson("visible-files.json", visibleFiles)
  await recorder.writeJson("omitted-files.json", omittedFiles)
  await recorder.writeText("context/diff.md", diff)
  await recorder.writeText("context/unified.diff", unifiedDiff)
  logger.info("Review agent stage completed", {
    ...context,
    stage: "diff",
    fetchedFileCount: files.length,
    filteredFileCount: filteredFiles.length,
    omittedFileCount: omittedFiles.length,
    diffChangedLineCount,
  })
  await recorder.appendEvent("stage.completed", {
    stage: "diff",
    fetchedFileCount: files.length,
    filteredFileCount: filteredFiles.length,
    omittedFileCount: omittedFiles.length,
    diffChangedLineCount,
  })

  const skipReason =
    filteredFiles.length === 0
      ? [
          "No reviewable file contents matched this repository's path filters.",
          ...(omittedFiles.length > 0
            ? [
                "",
                "Omitted changed files:",
                ...omittedFiles.map(
                  (file) => `- ${file.filename}: ${file.omittedReason}`
                ),
              ]
            : []),
        ].join("\n")
      : getDiffSkipReason(
          diffChangedLineCount,
          reviewConfig.maxReviewChangedLines
        )

  if (skipReason) {
    await updateReviewComment({
      repo: repository,
      installationId,
      commentId,
      pullRequestId: pullRequest.id,
      reviewRunId: reviewCommentRunId,
      body: `## Review summary\n\n${skipReason}`,
    })
    const result = {
      kind: "skipped" as const,
      triggerSource,
      modelId: REVIEW_MODEL,
      fetchedFileCount: files.length,
      filteredFileCount: filteredFiles.length,
      diffChangedLineCount,
      commentId,
      skipReason,
      startedAt: startedAtIso,
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
    }
    await recorder.writeJson("skip.json", result)
    await recorder.writeJson("summary.json", {
      status: "skipped",
      reviewRunId,
      repository: repository.fullName,
      pullRequestNumber: pullRequest.number,
      modelId: REVIEW_MODEL,
      verifierModelId: REVIEW_VERIFIER_MODEL,
      fetchedFileCount: files.length,
      filteredFileCount: filteredFiles.length,
      diffChangedLineCount,
      skipReason,
      counts: recorder.counts(),
      durationMs: result.durationMs,
    })
    await recorder.writeText(
      "published-comment.md",
      `## Review summary\n\n${skipReason}`
    )
    await recorder.appendEvent("review.skipped", result)
    logger.info("Review agent skipped", { ...context, ...result })
    return result
  }

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
  const linterUsages: unknown[] = []
  const suspicionIds = new Set<string>()
  let spawnBatch = 0
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
              maxRetries: 2,
              onStepFinish: async (step) => recorder.recordStep(step),
            })
            const generation = await agent.generate({ prompt })
            subagentUsages.push(generation.totalUsage)
            await recordBilling("subagents", REVIEW_VERIFIER_MODEL, generation)
            const output = reviewSubagentOutputSchema.parse(generation.output)
            const suspicions = output.suspicions.map((suspicion, index) => {
              const suspicionId = `batch-${batch}:${task.id}:${index + 1}`
              suspicionIds.add(suspicionId)
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
            return { taskId: task.id, suspicions }
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
      const output = {
        results: results.filter((item) => "suspicions" in item),
        failures: results.filter((item) => "error" in item),
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
  await recorder.writeText(
    "context/main-review-instructions.txt",
    mainReviewAgentInstructions
  )
  await recorder.writeText("context/main-review-prompt.txt", mainPrompt)
  await recorder.writeJson("context/main-review-prompt-stats.json", {
    promptBytes: textBytes(mainPrompt),
    diffBytes: textBytes(diff),
    affectedSymbolsBytes: textBytes(affectedSymbols),
    repositoryContextBytes: textBytes(preparedRepositoryContext.markdown),
    repositoryContextSource: preparedRepositoryContext.source,
    semanticEnabled,
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
        if (!suspicionIds.has(decision.suspicionId)) {
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
      const missingIds = [...suspicionIds].filter((id) => !seen.has(id))
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
    instructions: mainReviewAgentInstructions,
    tools: {
      ...createRepositoryTools("main"),
      spawn_review_agents: spawnReviewAgents,
    },
    providerOptions: mainProviderOptions,
    output: Output.object({
      schema: mainOutputSchema,
      name: "review_report",
      description:
        "Verified pull request review and a complete decision ledger for every delegated suspicion",
    }),
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
    findings: [...generatedReport.findings, ...linterFindings],
  }
  await recorder.writeJson("main-agent-output.json", {
    finishReason: mainGeneration.finishReason,
    usage: mainGeneration.totalUsage,
    providerMetadata: mainGeneration.providerMetadata,
    output: mainOutput,
    text: mainGeneration.text,
  })
  await recorder.writeJson("suspicion-decisions.json", mainOutput.decisions)
  const decisionCounts = {
    accepted: mainOutput.decisions.filter(
      (decision) => decision.decision === "accepted"
    ).length,
    duplicate: mainOutput.decisions.filter(
      (decision) => decision.decision === "duplicate"
    ).length,
    notBug: mainOutput.decisions.filter(
      (decision) => decision.decision === "not_bug"
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
  const generatedFindingCount = generatedReport.findings.length
  const validCandidateEntries = candidateReport.findings
    .map((finding, index) => ({ finding, index }))
    .filter((entry) => reportValidation.findings[entry.index]?.valid)
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
  const severityRank = { critical: 0, high: 1, medium: 2, low: 3 }
  const finalReport: ReviewReport = {
    ...candidateReport,
    findings: [
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
    ],
  }
  await recorder.writeJson(
    "candidate-review-report-validation.json",
    reportValidation
  )
  await recorder.writeJson(
    "evidence-filtered-findings.json",
    invalidEvidenceFindings
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
    naturalLanguageLinter: linterUsages,
  }
  logger.info("Review agent stage completed", {
    ...context,
    stage: "generation",
    usage: generationUsage,
    spawnBatches: spawnBatch,
    suspicionDecisions: decisionCounts,
    mergeSafetyScore: finalReport.mergeSafetyScore,
    findings: finalReport.findings.length,
    generatedFindings: generatedReport.findings.length,
    naturalLanguageLinterFindings: linterFindings.length,
    evidenceFilteredFindings: invalidEvidenceFindings.length,
  })
  await recorder.appendEvent("stage.completed", {
    stage: "generation",
    usage: generationUsage,
    spawnBatches: spawnBatch,
    suspicionDecisions: decisionCounts,
    mergeSafetyScore: finalReport.mergeSafetyScore,
    findings: finalReport.findings.length,
    generatedFindings: generatedReport.findings.length,
    naturalLanguageLinterFindings: linterFindings.length,
    evidenceFilteredFindings: invalidEvidenceFindings.length,
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
    fetchedFileCount: files.length,
    filteredFileCount: filteredFiles.length,
    diffChangedLineCount,
    commentId,
    reviewId,
    reviewEvent,
    inlineCommentCount,
    inlineReviewPublishError,
    mergeSafetyScore: finalReport.mergeSafetyScore,
    findings: finalReport.findings,
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
    fetchedFileCount: files.length,
    filteredFileCount: filteredFiles.length,
    diffChangedLineCount,
    semanticEnabled,
    qdrantEnabled: semanticEnabled,
    qdrantChunks,
    qdrantIndexedFiles,
    qdrantIgnoredFiles,
    qdrantLogicalWriteBytes,
    generatedFindings: generatedReport.findings.length,
    naturalLanguageLinterFindings: linterFindings.length,
    evidenceFilteredFindings: invalidEvidenceFindings.length,
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
