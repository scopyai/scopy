import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import { Output, ToolLoopAgent, tool } from "ai"
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
  resolveOpenRouterGenerationCost,
} from "../billing/usage"
import {
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
  mainReviewAgentInstructions,
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
  diffCharacterCount: number
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
    transactionId?: string
  }
  startedAt: string
  completedAt: string
  durationMs: number
}

const requireOpenRouterApiKey = () => {
  if (!env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is required to run the review agent")
  }

  return env.OPENROUTER_API_KEY
}

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
  generation: unknown
) => {
  const cost = await resolveOpenRouterGenerationCost(generation)
  if (cost.costMicrocents === null) {
    throw new Error(`OpenRouter cost is missing for ${stage}`)
  }
  const usage =
    typeof generation === "object" &&
    generation !== null &&
    "totalUsage" in generation
      ? (generation as { totalUsage: unknown }).totalUsage
      : undefined
  const entry = {
    modelId,
    usage,
    billingUnit: "micro_usd",
    costUsd: cost.cost,
    costMicroUsd: cost.costMicrocents,
    costMicrocents: cost.costMicrocents,
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
      stepCount?: number
      steps?: unknown[]
      calls?: unknown[]
    }
    stages[stage] = {
      ...existingEntry,
      costUsd: (existingEntry.costUsd ?? 0) + cost.cost,
      costMicroUsd: existingEntry.costMicroUsd + cost.costMicrocents,
      costMicrocents: existingEntry.costMicrocents + cost.costMicrocents,
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
  const diff = serializePullRequestFiles(filteredFiles)
  const unifiedDiff = serializePullRequestFilesAsUnifiedDiff(filteredFiles)
  const diffCharacterCount = diff.length
  await recorder.writeJson("review-config.json", reviewConfig)
  await recorder.writeJson("github-files.json", files)
  await recorder.writeJson("filtered-files.json", filteredFiles)
  await recorder.writeText("context/diff.md", diff)
  await recorder.writeText("context/unified.diff", unifiedDiff)
  logger.info("Review agent stage completed", {
    ...context,
    stage: "diff",
    fetchedFileCount: files.length,
    filteredFileCount: filteredFiles.length,
    diffCharacterCount,
  })
  await recorder.appendEvent("stage.completed", {
    stage: "diff",
    fetchedFileCount: files.length,
    filteredFileCount: filteredFiles.length,
    diffCharacterCount,
  })

  const skipReason =
    filteredFiles.length === 0
      ? "No reviewable changes matched this repository's path filters."
      : getDiffSkipReason(filteredFiles.length, diffCharacterCount)

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
      diffCharacterCount,
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
      diffCharacterCount,
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
  const openrouter = createOpenRouter({ apiKey: requireOpenRouterApiKey() })
  const mainModel = REVIEW_MODEL.startsWith("openai/")
    ? openrouter.chat(REVIEW_MODEL, {
        extraBody: { service_tier: reviewAgentConfig.openai.serviceTier },
      })
    : openrouter.chat(REVIEW_MODEL)
  const subagentModel = REVIEW_VERIFIER_MODEL.startsWith("openai/")
    ? openrouter.chat(REVIEW_VERIFIER_MODEL, {
        extraBody: { service_tier: reviewAgentConfig.openai.serviceTier },
      })
    : openrouter.chat(REVIEW_VERIFIER_MODEL)
  const llmBilling: Record<string, unknown> = {}
  const runtime = await prepareReviewRuntime({
    reviewRunId,
    repo: repository,
    pullRequest,
    installationId,
    changedFiles: filteredFiles.map((file) => file.filename),
  })
  const parsedDiffFiles = parseUnifiedDiff(unifiedDiff)
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
    contextProviderOptions: reviewModelProviderOptions,
    recorder,
    logger,
  })
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
              providerOptions: verifierModelProviderOptions,
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
            await recordLlmBilling(
              llmBilling,
              "subagents",
              REVIEW_VERIFIER_MODEL,
              generation
            )
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
    providerOptions: reviewModelProviderOptions,
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
  const mainUsage = await recordLlmBilling(
    llmBilling,
    "main",
    REVIEW_MODEL,
    mainGeneration
  )
  const mainOutput = mainOutputSchema.parse(mainGeneration.output)
  const generatedReport = reviewReportSchema.parse(mainOutput)
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
    report: generatedReport,
  })
  const invalidEvidenceFindings = generatedReport.findings.filter(
    (_, index) => !reportValidation.findings[index]?.valid
  )
  const finalReport: ReviewReport = {
    ...generatedReport,
    findings: generatedReport.findings.filter(
      (_, index) => reportValidation.findings[index]?.valid
    ),
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
  const generationUsage = { main: mainUsage, subagents: subagentUsages }
  logger.info("Review agent stage completed", {
    ...context,
    stage: "generation",
    usage: generationUsage,
    spawnBatches: spawnBatch,
    suspicionDecisions: decisionCounts,
    mergeSafetyScore: finalReport.mergeSafetyScore,
    findings: finalReport.findings.length,
    generatedFindings: generatedReport.findings.length,
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
    let inlineReview: {
      reviewId: number
      inlineCommentCount: number
      event: PullRequestReviewEvent
    } | null = null
    try {
      inlineReview = await publishPullRequestReview({
        repo: repository,
        installationId,
        pullRequestNumber: pullRequest.number,
        headSha: pullRequest.headSha,
        findings: finalReport.findings,
      })
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
    diffCharacterCount,
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
    diffCharacterCount,
    semanticEnabled,
    qdrantEnabled: semanticEnabled,
    qdrantChunks,
    qdrantIndexedFiles,
    qdrantIgnoredFiles,
    qdrantLogicalWriteBytes,
    generatedFindings: generatedReport.findings.length,
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
