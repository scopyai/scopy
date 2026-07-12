import { Output, ToolLoopAgent, stepCountIs, tool } from "ai"
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
import type { pullRequest, repository } from "../../db/schema"
import {
  calculateVectorNetworkCostMicrocents,
  calculateVectorQueryCostMicrocents,
  calculateVectorWriteCostMicrocents,
} from "../billing/usage"
import type { PullRequestFile } from "./diff"
import {
  batchNaturalLanguageLinterFiles,
  isLikelyGeneratedFile,
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
  buildMainReviewPrompt,
  buildNaturalLanguageLinterPrompt,
  buildReportComposerPrompt,
  buildReportSummaryPrompt,
  buildReviewVerifierPrompt,
  mainReviewAgentInstructions,
  mainReviewReportSchema,
  naturalLanguageLinterInstructions,
  naturalLanguageLinterOutputSchema,
  renderAffectedSymbols,
  renderChangedFilesOverview,
  renderChangedLineMap,
  renderReviewSummaryComment,
  renderSemanticCoverage,
  reportComposerInstructions,
  reportComposerOutputSchema,
  reportSummaryInstructions,
  reportSummaryOutputSchema,
  reviewDecisionSchema,
  reviewSubagentInstructions,
  reviewSubagentOutputSchema,
  reviewVerifierInstructions,
  reviewVerifierOutputSchema,
  safePathSegment,
  severityRank,
  type CandidateFinding,
  type ReviewReport,
} from "./prompt"
import {
  dedupeSameIssueFindings,
  dropFindingsCoveredBy,
  isSameIssue,
  mergeOverlappingCandidates,
  resemblesSameIssue,
  sortBySeverity,
} from "./findings"
import { createReviewRunRecorder } from "./debug-run"
import { reviewAgentConfig } from "./config"
import {
  createReviewLlm,
  recordLlmBilling,
  repairedJsonOutput,
  reviewModels,
} from "./llm"
import { prepareRepositoryContextForReview } from "./repository-context"
import { prepareReviewRuntime } from "./runtime"
import type { ReviewConfigValues } from "./review-config"

export const REVIEW_MODEL = reviewModels.main

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
  subagentModelId: string
  verifierModelId: string
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

const toolText = (text: string, maxBytes = 20_000) => {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text
  let output = text
  while (Buffer.byteLength(output, "utf8") > maxBytes) {
    output = output.slice(0, Math.floor(output.length * 0.9))
  }
  return `${output}\n\n[truncated]`
}

const textBytes = (text: string) => Buffer.byteLength(text, "utf8")

const chunked = <T>(items: T[], size: number) => {
  const chunks: T[][] = []
  for (let offset = 0; offset < items.length; offset += size) {
    chunks.push(items.slice(offset, offset + size))
  }
  return chunks
}

const mapConcurrent = async <T, R>(
  items: T[],
  concurrency: number,
  run: (item: T, index: number) => Promise<R>
) => {
  const results: R[] = []
  for (let offset = 0; offset < items.length; offset += concurrency) {
    results.push(
      ...(await Promise.all(
        items
          .slice(offset, offset + concurrency)
          .map((item, index) => run(item, offset + index))
      ))
    )
  }
  return results
}

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

type QueueItem = CandidateFinding & { queuedBy: "severity" | "verifier" }

type FindingDecision = {
  id: string
  stage: "merge" | "verifier" | "main"
  decision:
    | "duplicate"
    | "approve"
    | "reject"
    | "escalate"
    | "accept"
    | "failed_open"
  reason: string
  confidence?: number
  findingIndex?: number | null
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
    modelId: reviewModels.main,
    subagentModelId: reviewModels.subagent,
    verifierModelId: reviewModels.verifier,
  }
  const reviewCommentRunId =
    triggerSource === "mention" ? reviewRunId : undefined
  const recorder = await createReviewRunRecorder({
    reviewRunId,
    repo: repository,
    pullRequest,
    triggerSource,
    modelId: reviewModels.main,
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
  const diffStats = {
    fetchedFileCount,
    filteredFileCount: filteredFiles.length,
    omittedFileCount: omittedFiles.length,
    additions,
    deletions,
    diffChangedLineCount,
  }
  logger.info("Review agent stage completed", {
    ...context,
    stage: "diff",
    ...diffStats,
  })
  await recorder.appendEvent("stage.completed", { stage: "diff", ...diffStats })

  logger.info("Review agent stage started", { ...context, stage: "runtime" })
  await recorder.appendEvent("stage.started", { stage: "runtime" })
  const llm = createReviewLlm()
  const agentLayers = {
    main: {
      modelId: reviewModels.main,
      model: llm.chatModel(reviewModels.main),
      providerOptions: llm.providerOptionsFor(
        reviewModels.main,
        reviewAgentConfig.main.reasoningEffort
      ),
    },
    subagent: {
      modelId: reviewModels.subagent,
      model: llm.chatModel(reviewModels.subagent),
      providerOptions: llm.providerOptionsFor(
        reviewModels.subagent,
        reviewAgentConfig.subagent.reasoningEffort
      ),
    },
    verifier: {
      modelId: reviewModels.verifier,
      model: llm.chatModel(reviewModels.verifier),
      providerOptions: llm.providerOptionsFor(
        reviewModels.verifier,
        reviewAgentConfig.verifier.reasoningEffort
      ),
    },
    composer: {
      modelId: reviewModels.subagent,
      model: llm.chatModel(reviewModels.subagent),
      providerOptions: llm.providerOptionsFor(
        reviewModels.subagent,
        reviewAgentConfig.reportComposer.reasoningEffort
      ),
    },
  }
  const llmBilling: Record<string, unknown> = {}
  const recordBilling = (stage: string, modelId: string, generation: unknown) =>
    recordLlmBilling(
      llmBilling,
      stage,
      modelId,
      generation,
      llm.provider,
      llm.resolveGenerationCost
    )
  const usages: Record<string, unknown[]> = {
    subagents: [],
    verification: [],
    naturalLanguageLinter: [],
    reportComposer: [],
  }
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
    base: { sha: runtime.baseSha },
    semantic: { enabled: semanticEnabled },
    qdrant: runtime.qdrant
      ? {
          collection: runtime.qdrant.collection,
          model: runtime.qdrant.model,
          vectorSize: runtime.qdrant.vectorSize,
          configured: true,
        }
      : { configured: false },
  })
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
  const runtimeStats = {
    repositoryPath: runtime.paths.repositoryPath,
    diagnostics: runtime.codeIndex.diagnostics.length,
    semanticEnabled,
    qdrantEnabled: semanticEnabled,
    qdrantChunks,
    qdrantIndexedFiles,
    qdrantIgnoredFiles,
    qdrantLogicalWriteBytes,
  }
  logger.info("Review agent stage completed", {
    ...context,
    stage: "runtime",
    ...runtimeStats,
  })
  await recorder.appendEvent("stage.completed", {
    stage: "runtime",
    ...runtimeStats,
  })

  logger.info("Review agent stage started", {
    ...context,
    stage: "repository-context",
  })
  await recorder.appendEvent("stage.started", { stage: "repository-context" })
  const preparedRepositoryContext = await prepareRepositoryContextForReview({
    repo: repository,
    pullRequest,
    loadBase: runtime.loadBase,
    baseSha: runtime.baseSha,
    contextModel: agentLayers.subagent.model,
    contextModelId: agentLayers.subagent.modelId,
    contextProviderOptions: agentLayers.subagent.providerOptions,
    recorder,
    logger,
  })
  if (preparedRepositoryContext.billingGeneration) {
    await recordBilling(
      "repository_context",
      agentLayers.subagent.modelId,
      preparedRepositoryContext.billingGeneration
    )
  }
  const repositoryContextStats = {
    stage: "repository-context",
    source: preparedRepositoryContext.source,
    reason: preparedRepositoryContext.reason,
    contextId: preparedRepositoryContext.contextId,
    baseSha: preparedRepositoryContext.baseSha,
    markdownBytes: textBytes(preparedRepositoryContext.markdown),
  }
  logger.info("Review agent stage completed", {
    ...context,
    ...repositoryContextStats,
  })
  await recorder.appendEvent("stage.completed", repositoryContextStats)

  logger.info("Review agent stage started", { ...context, stage: "generation" })
  await recorder.appendEvent("stage.started", { stage: "generation" })
  let vectorQueryBytes = 0
  let vectorNetworkBytes = 0
  let vectorQueryCount = 0
  const createRepositoryTools = (
    scope: string,
    onFileRead?: (file: string) => void
  ) => {
    const base = {
      read_file: tool({
        description:
          "Read numbered lines from any repository file. Reads 300 lines by default and up to 800; prefer one large read over paging through a file in small chunks.",
        inputSchema: z.object({
          file: z.string().min(1),
          startLine: z.number().int().positive().optional(),
          maxLines: z.number().int().positive().max(800).optional(),
        }),
        execute: async ({ file, startLine, maxLines }) => {
          const input = { file, startLine, maxLines }
          const output = await readRepositoryFile({
            repository: runtime.paths.repositoryPath,
            file,
            startLine,
            maxLines,
          })
          onFileRead?.(file)
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
          const result = await getSymbolDefinition({
            repository: runtime.paths.repositoryPath,
            index: runtime.codeIndex,
            symbol,
          })
          const output = { ...result.json, stats: result.stats }
          await recorder.recordToolCall({
            name: `${scope}.get_symbol_definition`,
            input: { symbol },
            output,
          })
          return output
        },
      }),
      get_symbol_callers: tool({
        description: "Get direct call locations and enclosing caller metadata.",
        inputSchema: z.object({ symbol: z.string().min(1) }),
        execute: async ({ symbol }) => {
          const result = await getSymbolCallers({
            repository: runtime.paths.repositoryPath,
            index: runtime.codeIndex,
            symbol,
          })
          const output = { ...result.json, stats: result.stats }
          await recorder.recordToolCall({
            name: `${scope}.get_symbol_callers`,
            input: { symbol },
            output,
          })
          return output
        },
      }),
      locate_text: tool({
        description: "Search exact text across repository files.",
        inputSchema: z.object({ query: z.string().min(1) }),
        execute: async ({ query }) => {
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
            input: { query },
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
            input: { query, limit },
            output,
          })
          return output
        },
      }),
    }
  }

  const allCandidateIds = new Set<string>()
  let routedCandidates: CandidateFinding[] = []
  const approvedCandidates: CandidateFinding[] = []
  const mainQueue: QueueItem[] = []
  const mainQueueIds = new Set<string>()
  const findingDecisions: FindingDecision[] = []
  const subagentCoveredFiles = new Set<string>()
  let spawnBatch = 0

  const compactFinding = (candidate: CandidateFinding) => ({
    id: candidate.id,
    severity: candidate.severity,
    file: candidate.file,
    startLine: candidate.startLine,
    endLine: candidate.endLine,
    title: candidate.title,
  })

  const overlapsRouted = (candidate: CandidateFinding) =>
    routedCandidates.find((routed) => isSameIssue(routed, candidate))

  const runVerifierChunk = async ({
    batch,
    chunkIndex,
    candidates,
  }: {
    batch: number
    chunkIndex: number
    candidates: CandidateFinding[]
  }) => {
    const chunkId = String(chunkIndex + 1).padStart(2, "0")
    const expectedIds = candidates.map((candidate) => candidate.id)
    const expectedIdSet = new Set(expectedIds)
    const outputSchema = reviewVerifierOutputSchema.superRefine(
      (output, validation) => {
        const seen = new Set<string>()
        const problems: string[] = []
        for (const verdict of output.verdicts) {
          if (!expectedIdSet.has(verdict.id))
            problems.push(`unknown ${verdict.id}`)
          seen.add(verdict.id)
        }
        for (const id of expectedIds) {
          if (!seen.has(id)) problems.push(`missing ${id}`)
        }
        if (problems.length > 0) {
          validation.addIssue({
            code: "custom",
            path: ["verdicts"],
            message: `Return exactly one verdict per candidate id. Problems: ${problems.join(", ")}.`,
          })
        }
      }
    )
    const prompt = buildReviewVerifierPrompt({
      title: pullRequest.title,
      body: pullRequest.body,
      baseRef: pullRequest.baseRef,
      headRef: pullRequest.headRef,
      changedLineMap,
      candidates,
    })
    await recorder.writeText(
      `verifier/batch-${batch}/chunk-${chunkId}/prompt.txt`,
      prompt
    )
    let lastError: unknown
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const attemptSteps: unknown[] = []
      try {
        const agent = new ToolLoopAgent({
          model: agentLayers.verifier.model,
          instructions: reviewVerifierInstructions,
          tools: createRepositoryTools(
            `verifier.${batch}.${chunkId}.${attempt}`
          ),
          providerOptions: agentLayers.verifier.providerOptions,
          output: repairedJsonOutput(
            Output.object({
              schema: outputSchema,
              name: "verified_findings",
              description: "One verdict for every supplied candidate id",
            })
          ),
          stopWhen: stepCountIs(reviewAgentConfig.verifier.maxSteps),
          maxRetries: 2,
          onStepFinish: async (step) => {
            attemptSteps.push(step)
            await recorder.recordStep(step)
          },
        })
        const generation = await agent.generate({ prompt })
        usages.verification!.push(generation.totalUsage)
        await recordBilling(
          "verification",
          agentLayers.verifier.modelId,
          generation
        )
        attemptSteps.length = 0
        const output = outputSchema.parse(generation.output)
        await recorder.writeJson(
          `verifier/batch-${batch}/chunk-${chunkId}/attempt-${attempt}.json`,
          {
            finishReason: generation.finishReason,
            usage: generation.totalUsage,
            output,
          }
        )
        return output.verdicts
      } catch (error) {
        lastError = error
        if (attemptSteps.length > 0) {
          await recordBilling("verification", agentLayers.verifier.modelId, {
            steps: attemptSteps,
          })
        }
        await recorder.writeJson(
          `verifier/batch-${batch}/chunk-${chunkId}/attempt-${attempt}-error.json`,
          { error }
        )
        await recorder.appendEvent("verifier.attempt.failed", {
          batch,
          chunk: chunkId,
          attempt,
          error: errorMessage(error),
        })
      }
    }
    const reason = `Verifier failed open: ${errorMessage(lastError)}`
    await recorder.appendEvent("verifier.failed_open", {
      batch,
      chunk: chunkId,
      candidates: candidates.length,
      escalated: candidates.length,
      error: reason,
    })
    return candidates.map((candidate) => ({
      id: candidate.id,
      verdict: "escalate" as const,
      confidence: 0,
      reason,
      failedOpen: true,
    }))
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
      const knownFindings =
        routedCandidates.length > 0
          ? `

Already reported findings (do not re-report these or restate their root causes — but the files they live in are proven bug-dense, so look for different defects in those same files as well as everywhere else):
${routedCandidates
  .map(
    (candidate) =>
      `- ${candidate.file}:${candidate.startLine}-${candidate.endLine} [${candidate.severity}] ${candidate.title}`
  )
  .join("\n")}`
          : ""
      const sharedContext = `Pull request title: ${pullRequest.title}
Pull request description: ${pullRequest.body ?? "(none)"}
Base branch: ${pullRequest.baseRef}
Head branch: ${pullRequest.headRef}

Repository context:
${preparedRepositoryContext.markdown}

Changed files:
${diff}

Changed symbol index:
${affectedSymbols}${knownFindings}`

      type TaskResult = {
        taskId: string
        candidates: CandidateFinding[]
        error?: string
      }
      const runTask = async (task: {
        id: string
        objective: string
      }): Promise<TaskResult> => {
        const safeId = `${String(tasks.indexOf(task) + 1).padStart(2, "0")}-${safePathSegment(task.id)}`
        const prompt = `${sharedContext}

Assigned exploration:
${task.objective}`
        await recorder.writeText(
          `subagents/batch-${batch}/${safeId}/prompt.txt`,
          prompt
        )
        let lastError: unknown
        const taskReadFiles = new Set<string>()
        for (let attempt = 1; attempt <= 2; attempt += 1) {
          const attemptSteps: unknown[] = []
          try {
            const agent = new ToolLoopAgent({
              model: agentLayers.subagent.model,
              instructions: reviewSubagentInstructions,
              tools: createRepositoryTools(
                `subagent.${batch}.${safeId}.${attempt}`,
                (file) => taskReadFiles.add(file)
              ),
              providerOptions: agentLayers.subagent.providerOptions,
              output: repairedJsonOutput(
                Output.object({
                  schema: reviewSubagentOutputSchema,
                  name: "review_findings",
                  description:
                    "Unfiltered candidate bug findings with evidence",
                })
              ),
              stopWhen: stepCountIs(reviewAgentConfig.subagent.maxSteps),
              maxRetries: 2,
              onStepFinish: async (step) => {
                attemptSteps.push(step)
                await recorder.recordStep(step)
              },
            })
            const generation = await agent.generate({ prompt })
            usages.subagents!.push(generation.totalUsage)
            await recordBilling(
              "subagents",
              agentLayers.subagent.modelId,
              generation
            )
            attemptSteps.length = 0
            const output = reviewSubagentOutputSchema.parse(generation.output)
            const candidates = output.findings.map((finding, index) => {
              const id = `b${batch}:${task.id}:${index + 1}`
              allCandidateIds.add(id)
              return {
                ...finding,
                startLine: Math.min(finding.startLine, finding.endLine),
                endLine: Math.max(finding.startLine, finding.endLine),
                id,
                taskId: task.id,
                supportingTaskIds: [task.id],
              } satisfies CandidateFinding
            })
            await recorder.writeJson(
              `subagents/batch-${batch}/${safeId}/attempt-${attempt}.json`,
              {
                finishReason: generation.finishReason,
                usage: generation.totalUsage,
                output,
              }
            )
            await recorder.appendEvent("subagent.completed", {
              batch,
              taskId: task.id,
              attempt,
              findings: candidates.length,
            })
            for (const file of taskReadFiles) {
              subagentCoveredFiles.add(file)
            }
            return { taskId: task.id, candidates }
          } catch (error) {
            lastError = error
            if (attemptSteps.length > 0) {
              await recordBilling("subagents", agentLayers.subagent.modelId, {
                steps: attemptSteps,
              })
            }
            await recorder.writeJson(
              `subagents/batch-${batch}/${safeId}/attempt-${attempt}-error.json`,
              { error }
            )
            await recorder.appendEvent("subagent.attempt.failed", {
              batch,
              taskId: task.id,
              attempt,
              error: errorMessage(error),
            })
          }
        }
        return {
          taskId: task.id,
          candidates: [],
          error: errorMessage(lastError),
        }
      }

      const taskResults = await mapConcurrent(tasks, 4, runTask)
      const rawCandidates = taskResults.flatMap((result) => result.candidates)
      for (const candidate of rawCandidates) {
        subagentCoveredFiles.add(candidate.file)
      }
      const uncoveredFiles = filteredFiles
        .map((file) => file.filename)
        .filter(
          (file) =>
            !subagentCoveredFiles.has(file) && !isLikelyGeneratedFile(file)
        )

      const freshCandidates: CandidateFinding[] = []
      for (const candidate of rawCandidates) {
        const routed = overlapsRouted(candidate)
        if (routed) {
          findingDecisions.push({
            id: candidate.id,
            stage: "merge",
            decision: "duplicate",
            reason: `Overlaps ${routed.id}, which was already routed in an earlier batch.`,
          })
        } else {
          freshCandidates.push(candidate)
        }
      }
      const { merged, duplicates } = mergeOverlappingCandidates(freshCandidates)
      for (const duplicate of duplicates) {
        findingDecisions.push({
          id: duplicate.id,
          stage: "merge",
          decision: "duplicate",
          reason:
            "Overlaps another candidate in this batch; the strongest representative was kept.",
        })
      }
      routedCandidates.push(...merged)

      const batchQueue: QueueItem[] = []
      const queueCandidate = (
        candidate: CandidateFinding,
        queuedBy: QueueItem["queuedBy"]
      ) => {
        const item = { ...candidate, queuedBy }
        batchQueue.push(item)
        mainQueue.push(item)
        mainQueueIds.add(candidate.id)
      }
      const toVerify: CandidateFinding[] = []
      for (const candidate of merged) {
        if (
          candidate.severity === "critical" ||
          candidate.severity === "high"
        ) {
          queueCandidate(candidate, "severity")
        } else {
          toVerify.push(candidate)
        }
      }

      const batchApproved: CandidateFinding[] = []
      let rejectedCount = 0
      const verifierChunks = chunked(
        toVerify,
        reviewAgentConfig.verifier.maxFindingsPerCall
      )
      const verdictGroups = await mapConcurrent(
        verifierChunks,
        4,
        (candidates, chunkIndex) =>
          runVerifierChunk({ batch, chunkIndex, candidates })
      )
      const candidatesById = new Map(
        toVerify.map((candidate) => [candidate.id, candidate])
      )
      const decidedIds = new Set<string>()
      for (const verdict of verdictGroups.flat()) {
        if (decidedIds.has(verdict.id)) continue
        decidedIds.add(verdict.id)
        const candidate = candidatesById.get(verdict.id)!
        findingDecisions.push({
          id: verdict.id,
          stage: "verifier",
          decision:
            "failedOpen" in verdict && verdict.failedOpen
              ? "failed_open"
              : verdict.verdict,
          reason: verdict.reason,
          confidence: verdict.confidence,
        })
        if (verdict.verdict === "approve") {
          approvedCandidates.push(candidate)
          batchApproved.push(candidate)
        } else if (verdict.verdict === "escalate") {
          queueCandidate(candidate, "verifier")
        } else {
          rejectedCount += 1
          routedCandidates = routedCandidates.filter(
            (routed) => routed.id !== verdict.id
          )
        }
      }

      const output = {
        tasks: taskResults.map((result) =>
          result.error
            ? { taskId: result.taskId, error: result.error }
            : { taskId: result.taskId, findings: result.candidates.length }
        ),
        reviewQueue: batchQueue.map(
          ({ taskId: _taskId, queuedBy: _queuedBy, ...item }) => item
        ),
        approvedFindings: batchApproved.map(compactFinding),
        uncoveredFiles,
        stats: {
          rawFindings: rawCandidates.length,
          mergedDuplicates: rawCandidates.length - merged.length,
          verified: toVerify.length,
          approved: batchApproved.length,
          rejected: rejectedCount,
          queuedForMainReview: batchQueue.length,
          uncoveredFiles: uncoveredFiles.length,
        },
      }
      await recorder.writeJson(`subagents/batch-${batch}/result.json`, output)
      await recorder.recordToolCall({
        name: "main.spawn_review_agents",
        input: { tasks },
        output,
      })
      await recorder.appendEvent("subagents.batch.completed", {
        batch,
        ...output.stats,
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
              return `## ${file}\nChanged head lines: ${lines.join(", ")}\nCould not read numbered excerpt: ${errorMessage(error)}`
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
        model: agentLayers.subagent.model,
        instructions: naturalLanguageLinterInstructions,
        tools: {},
        providerOptions: agentLayers.subagent.providerOptions,
        output: repairedJsonOutput(
          Output.object({
            schema: naturalLanguageLinterOutputSchema,
            name: "natural_language_linter_findings",
            description:
              "Natural-language rule findings grouped by assigned file",
          })
        ),
        stopWhen: stepCountIs(reviewAgentConfig.naturalLanguageLinter.maxSteps),
        maxRetries: 2,
        onStepFinish: async (step) => recorder.recordStep(step),
      })
      const generation = await agent.generate({ prompt })
      usages.naturalLanguageLinter!.push(generation.totalUsage)
      await recordBilling(
        "natural_language_linter",
        agentLayers.subagent.modelId,
        generation
      )

      const output = naturalLanguageLinterOutputSchema.parse(generation.output)
      const outputByFile = new Map(
        output.files.map((file) => [file.file, file])
      )
      await recorder.writeJson(
        `natural-language-linter/batch-${batchId}/output.json`,
        {
          assignedFiles,
          finishReason: generation.finishReason,
          usage: generation.totalUsage,
          output,
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

    const findings = (await mapConcurrent(batches, 4, runBatch)).flat()

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

  const runReportComposer = async (): Promise<{
    summary: string
    changedFiles: ReviewReport["changedFiles"]
  }> => {
    const fallbackFileSummary = (file: PullRequestFile) => ({
      file: file.filename,
      summary: `${file.status} file with ${file.additions} added and ${file.deletions} deleted lines.`,
    })
    const omittedFileSummaries = omittedFiles.map((file) => ({
      file: file.filename,
      summary: file.omittedReason ?? "Patch omitted.",
    }))
    const fallbackSummary = `${pullRequest.title}${pullRequest.body ? `\n\n${pullRequest.body}` : ""}`

    if (filteredFiles.length === 0) {
      return { summary: fallbackSummary, changedFiles: omittedFileSummaries }
    }

    logger.info("Review agent stage started", {
      ...context,
      stage: "report-composer",
      files: filteredFiles.length,
    })
    await recorder.appendEvent("stage.started", {
      stage: "report-composer",
      files: filteredFiles.length,
    })

    const runBatch = async (
      batch: PullRequestFile[],
      index: number
    ): Promise<ReviewReport["changedFiles"]> => {
      const batchId = String(index + 1).padStart(2, "0")
      const assignedFiles = batch.map((file) => file.filename)
      const prompt = buildReportComposerPrompt({
        diff: serializePullRequestFiles(batch),
      })
      await recorder.writeText(
        `report-composer/batch-${batchId}/prompt.txt`,
        prompt
      )
      try {
        const agent = new ToolLoopAgent({
          model: agentLayers.composer.model,
          instructions: reportComposerInstructions,
          tools: {},
          providerOptions: agentLayers.composer.providerOptions,
          output: repairedJsonOutput(
            Output.object({
              schema: reportComposerOutputSchema,
              name: "changed_file_summaries",
              description: "One concise change summary per assigned file",
            })
          ),
          stopWhen: stepCountIs(reviewAgentConfig.reportComposer.maxSteps),
          maxRetries: 2,
          onStepFinish: async (step) => recorder.recordStep(step),
        })
        const generation = await agent.generate({ prompt })
        usages.reportComposer!.push(generation.totalUsage)
        await recordBilling(
          "report_composer",
          agentLayers.composer.modelId,
          generation
        )
        const output = reportComposerOutputSchema.parse(generation.output)
        await recorder.writeJson(
          `report-composer/batch-${batchId}/output.json`,
          {
            assignedFiles,
            finishReason: generation.finishReason,
            usage: generation.totalUsage,
            output,
          }
        )
        const outputByFile = new Map(
          output.files.map((file) => [file.file, file])
        )
        return batch.map(
          (file) => outputByFile.get(file.filename) ?? fallbackFileSummary(file)
        )
      } catch (error) {
        await recorder.writeJson(
          `report-composer/batch-${batchId}/error.json`,
          {
            error,
          }
        )
        await recorder.appendEvent("report_composer.batch.failed_open", {
          batch: batchId,
          files: assignedFiles.length,
          error: errorMessage(error),
        })
        return batch.map(fallbackFileSummary)
      }
    }

    const batches = batchNaturalLanguageLinterFiles(filteredFiles, 8)
    const changedFiles = (await mapConcurrent(batches, 4, runBatch)).flat()
    changedFiles.push(...omittedFileSummaries)

    let summary = fallbackSummary
    try {
      const prompt = buildReportSummaryPrompt({
        title: pullRequest.title,
        body: pullRequest.body,
        baseRef: pullRequest.baseRef,
        headRef: pullRequest.headRef,
        fileSummaries: changedFiles,
      })
      await recorder.writeText("report-composer/summary-prompt.txt", prompt)
      const agent = new ToolLoopAgent({
        model: agentLayers.composer.model,
        instructions: reportSummaryInstructions,
        tools: {},
        providerOptions: agentLayers.composer.providerOptions,
        output: repairedJsonOutput(
          Output.object({
            schema: reportSummaryOutputSchema,
            name: "review_summary",
            description: "The summary section of the pull request review",
          })
        ),
        stopWhen: stepCountIs(reviewAgentConfig.reportComposer.maxSteps),
        maxRetries: 2,
        onStepFinish: async (step) => recorder.recordStep(step),
      })
      const generation = await agent.generate({ prompt })
      usages.reportComposer!.push(generation.totalUsage)
      await recordBilling(
        "report_composer",
        agentLayers.composer.modelId,
        generation
      )
      summary = reportSummaryOutputSchema.parse(generation.output).summary
    } catch (error) {
      await recorder.writeJson("report-composer/summary-error.json", { error })
      await recorder.appendEvent("report_composer.summary.failed_open", {
        error: errorMessage(error),
      })
    }

    await recorder.writeJson("report-composer/result.json", {
      summary,
      changedFiles,
    })
    logger.info("Review agent stage completed", {
      ...context,
      stage: "report-composer",
      batches: batches.length,
      changedFiles: changedFiles.length,
    })
    await recorder.appendEvent("stage.completed", {
      stage: "report-composer",
      batches: batches.length,
      changedFiles: changedFiles.length,
    })
    return { summary, changedFiles }
  }

  const changedFilesOverview = renderChangedFilesOverview({
    files: filteredFiles,
    omittedFiles,
    changedLinesByFile,
  })
  const patchesByFile = new Map(
    filteredFiles.map((file) => [file.filename, file])
  )
  const omittedByFile = new Map(
    omittedFiles.map((file) => [file.filename, file])
  )
  const readPatch = tool({
    description:
      "Read the full diff patch for one changed file in this pull request.",
    inputSchema: z.object({ file: z.string().min(1) }),
    execute: async ({ file }) => {
      const entry = patchesByFile.get(file)
      const omitted = omittedByFile.get(file)
      const output = entry
        ? { file, patch: toolText(serializePullRequestFiles([entry])) }
        : omitted
          ? { file, patch: omitted.omittedReason ?? "Patch omitted." }
          : {
              file,
              error:
                "Not a changed file in this pull request. Use the exact repository-relative path from the changed files overview.",
            }
      await recorder.recordToolCall({
        name: "main.read_patch",
        input: { file },
        output,
      })
      return output
    },
  })
  const mainPrompt = buildMainReviewPrompt({
    title: pullRequest.title,
    body: pullRequest.body,
    baseRef: pullRequest.baseRef,
    headRef: pullRequest.headRef,
    changedFilesOverview,
    affectedSymbols,
    repositoryContext: preparedRepositoryContext.markdown,
  })
  await recorder.writeText("context/main-review-prompt.txt", mainPrompt)
  await recorder.writeJson("context/main-review-prompt-stats.json", {
    promptBytes: textBytes(mainPrompt),
    diffBytes: textBytes(diff),
    changedFilesOverviewBytes: textBytes(changedFilesOverview),
    affectedSymbolsBytes: textBytes(affectedSymbols),
    repositoryContextBytes: textBytes(preparedRepositoryContext.markdown),
    repositoryContextSource: preparedRepositoryContext.source,
    semanticEnabled,
  })
  const mainOutputSchema = mainReviewReportSchema
    .extend({
      decisions: z.array(reviewDecisionSchema),
      vetoedApprovedFindings: z.array(
        z.object({ id: z.string(), reason: z.string() })
      ),
    })
    .superRefine((output, validation) => {
      const seen = new Set<string>()
      const problems: string[] = []
      for (const decision of output.decisions) {
        if (!mainQueueIds.has(decision.id))
          problems.push(`unknown ${decision.id}`)
        seen.add(decision.id)
        if (
          decision.decision === "accept" &&
          (decision.findingIndex === null ||
            decision.findingIndex >= output.findings.length)
        ) {
          problems.push(
            `accepted ${decision.id} must reference an existing findingIndex`
          )
        }
        if (decision.decision !== "accept" && decision.findingIndex !== null) {
          problems.push(
            `non-accepted ${decision.id} must set findingIndex to null`
          )
        }
      }
      for (const id of mainQueueIds) {
        if (!seen.has(id)) problems.push(`missing ${id}`)
      }
      if (problems.length > 0) {
        validation.addIssue({
          code: "custom",
          path: ["decisions"],
          message: `Return exactly one decision per reviewQueue id. Problems: ${problems.join(", ")}.`,
        })
      }
    })
  const mainAgent = new ToolLoopAgent({
    model: agentLayers.main.model,
    instructions: mainReviewAgentInstructions,
    tools: {
      ...createRepositoryTools("main"),
      read_patch: readPatch,
      spawn_review_agents: spawnReviewAgents,
    },
    providerOptions: agentLayers.main.providerOptions,
    output: repairedJsonOutput(
      Output.object({
        schema: mainOutputSchema,
        name: "review_report",
        description:
          "Final review findings and one decision per escalated reviewQueue id",
      })
    ),
    stopWhen: stepCountIs(reviewAgentConfig.main.maxSteps),
    maxRetries: 2,
    onStepFinish: async (step) => recorder.recordStep(step),
  })

  const composedReportPromise = runReportComposer()
  let mainGeneration = await mainAgent.generate({ prompt: mainPrompt })
  const mainUsages = [
    await recordBilling("main", agentLayers.main.modelId, mainGeneration),
  ]
  const uncoveredAfterMain = filteredFiles
    .map((file) => file.filename)
    .filter(
      (file) => !subagentCoveredFiles.has(file) && !isLikelyGeneratedFile(file)
    )
  if (uncoveredAfterMain.length > 0) {
    await recorder.appendEvent("main.coverage_enforced", {
      files: uncoveredAfterMain,
    })
    mainGeneration = await mainAgent.generate({
      messages: [
        { role: "user" as const, content: mainPrompt },
        ...mainGeneration.response.messages,
        {
          role: "user" as const,
          content: `These changed files were never inspected by any subagent: ${uncoveredAfterMain.join(", ")}. Spawn one follow-up batch that covers them (a single task is fine), then return the final report again with one decision per reviewQueue id, including any newly escalated ids.`,
        },
      ],
    })
    mainUsages.push(
      await recordBilling("main", agentLayers.main.modelId, mainGeneration)
    )
  }
  const mainOutput = mainOutputSchema.parse(mainGeneration.output)
  if (spawnBatch === 0) {
    logger.error("Main agent returned a report without spawning subagents", {
      ...context,
      stage: "generation",
    })
    await recorder.appendEvent("main.delegation_skipped", {
      findings: mainOutput.findings.length,
    })
  }
  const recordedDecisionIds = new Set<string>()
  for (const decision of mainOutput.decisions) {
    if (recordedDecisionIds.has(decision.id)) continue
    recordedDecisionIds.add(decision.id)
    findingDecisions.push({
      id: decision.id,
      stage: "main",
      decision: decision.decision,
      reason: decision.reason,
      findingIndex: decision.findingIndex,
    })
  }
  const linterFindings = await runNaturalLanguageLinter()
  const composedReport = await composedReportPromise

  const mainFindings = mainOutput.findings.map((finding) => ({
    ...finding,
    source: "review" as const,
  }))
  const vetoReasonById = new Map(
    mainOutput.vetoedApprovedFindings
      .filter((veto) =>
        approvedCandidates.some((candidate) => candidate.id === veto.id)
      )
      .map((veto) => [veto.id, veto.reason])
  )
  for (const [id, reason] of vetoReasonById) {
    findingDecisions.push({ id, stage: "main", decision: "reject", reason })
  }
  if (vetoReasonById.size > 0) {
    await recorder.appendEvent("main.approved_vetoed", {
      ids: [...vetoReasonById.keys()],
    })
  }
  const approvedFindings = approvedCandidates
    .filter((candidate) => !vetoReasonById.has(candidate.id))
    .map(
      ({
        id: _id,
        taskId: _t,
        supportingTaskIds: _s,
        evidence: _e,
        ...finding
      }) => ({
        ...finding,
        source: "review" as const,
      })
    )
  const publishedPool = [...mainFindings, ...approvedFindings]
  const restoredDuplicates = mainOutput.decisions
    .filter((decision) => decision.decision === "duplicate")
    .flatMap((decision) => {
      const candidate = mainQueue.find((item) => item.id === decision.id)
      if (!candidate) return []
      const covered = publishedPool.some(
        (finding) =>
          severityRank[finding.severity] <= severityRank[candidate.severity] &&
          resemblesSameIssue(finding, candidate)
      )
      return covered ? [] : [candidate]
    })
  for (const candidate of restoredDuplicates) {
    findingDecisions.push({
      id: candidate.id,
      stage: "main",
      decision: "accept",
      reason:
        "Duplicate decision overridden: no surviving finding of equal or higher severity resembles this candidate.",
    })
  }
  if (restoredDuplicates.length > 0) {
    await recorder.appendEvent("main.duplicate_overridden", {
      ids: restoredDuplicates.map((candidate) => candidate.id),
    })
  }
  const restoredFindings = restoredDuplicates.map(
    ({
      id: _id,
      taskId: _t,
      supportingTaskIds: _s,
      evidence: _e,
      queuedBy: _q,
      ...finding
    }) => ({
      ...finding,
      source: "review" as const,
    })
  )
  const bugFindings = dedupeSameIssueFindings(
    sortBySeverity([...mainFindings, ...approvedFindings, ...restoredFindings])
  )
  const candidateReport: ReviewReport = {
    summary: composedReport.summary,
    changedFiles: composedReport.changedFiles,
    reviewerAttention: mainOutput.reviewerAttention,
    mergeSafetyScore: mainOutput.mergeSafetyScore,
    mergeSafetyReason: mainOutput.mergeSafetyReason,
    findings: [...bugFindings, ...linterFindings],
  }

  await recorder.writeJson("main-agent-output.json", {
    finishReason: mainGeneration.finishReason,
    usage: mainGeneration.totalUsage,
    providerMetadata: mainGeneration.providerMetadata,
    output: mainOutput,
  })
  await recorder.writeJson("finding-decisions.json", findingDecisions)

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
  const validatedFindings = candidateReport.findings.flatMap(
    (finding, index) => {
      const validation = reportValidation.findings[index]
      if (!validation?.valid) return []
      return [
        validation.normalized
          ? {
              ...finding,
              file: validation.normalized.file,
              startLine: validation.normalized.startLine,
              endLine: validation.normalized.endLine,
            }
          : finding,
      ]
    }
  )
  const validatedBugFindings = validatedFindings.filter(
    (finding) => finding.source !== "natural_language_linter"
  )
  const validatedLinterFindings = validatedFindings.filter(
    (finding) => finding.source === "natural_language_linter"
  )
  const finalFindings = [
    ...validatedBugFindings,
    ...dropFindingsCoveredBy(validatedLinterFindings, validatedBugFindings),
  ]
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
  const generationUsage = { main: mainUsages, ...usages }
  const decisionCounts = findingDecisions.reduce<Record<string, number>>(
    (counts, decision) => {
      const key = `${decision.stage}:${decision.decision}`
      counts[key] = (counts[key] ?? 0) + 1
      return counts
    },
    {}
  )
  const generationStats = {
    usage: generationUsage,
    spawnBatches: spawnBatch,
    rawFindingCount: allCandidateIds.size,
    mainQueueCount: mainQueueIds.size,
    verifierApprovedCount: approvedCandidates.length,
    decisionCounts,
    publishedFindingCount: finalReport.findings.length,
    mainFindings: mainOutput.findings.length,
    naturalLanguageLinterFindings: linterFindings.length,
    evidenceFilteredFindings: invalidEvidenceFindings.length,
    evidenceRepairedFindings: evidenceRepairedFindings.length,
  }
  logger.info("Review agent stage completed", {
    ...context,
    stage: "generation",
    ...generationStats,
  })
  await recorder.appendEvent("stage.completed", {
    stage: "generation",
    ...generationStats,
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
      const bugInlineFindings = finalReport.findings.filter(
        (finding) => finding.source !== "natural_language_linter"
      )
      const lintInlineFindings = finalReport.findings.filter(
        (finding) => finding.source === "natural_language_linter"
      )

      if (bugInlineFindings.length > 0) {
        const bugReview = await publishPullRequestReview({
          repo: repository,
          installationId,
          pullRequestNumber: pullRequest.number,
          headSha: pullRequest.headSha,
          findings: bugInlineFindings,
        })
        if (bugReview) inlineReviews.push(bugReview)
      }

      if (lintInlineFindings.length > 0) {
        const lintReview = await publishPullRequestReview({
          repo: repository,
          installationId,
          pullRequestNumber: pullRequest.number,
          headSha: pullRequest.headSha,
          findings: lintInlineFindings,
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
    if (lastInlineReview) {
      reviewId = lastInlineReview.reviewId
      reviewEvent = lastInlineReview.event
      inlineCommentCount = inlineReviews.reduce(
        (total, review) => total + review.inlineCommentCount,
        0
      )
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
  const totalCostMicrocents =
    llmCostMicrocents +
    vectorWriteCostMicrocents +
    vectorQueryCostMicrocents +
    vectorNetworkCostMicrocents
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
    totalCostMicroUsd: totalCostMicrocents,
    totalCostMicrocents,
    llm: llmBilling,
  }
  const result = {
    kind: "summary" as const,
    summary: publishedReport,
    triggerSource,
    modelId: reviewModels.main,
    subagentModelId: reviewModels.subagent,
    verifierModelId: reviewModels.verifier,
    fetchedFileCount,
    filteredFileCount: filteredFiles.length,
    diffChangedLineCount,
    commentId,
    reviewId,
    reviewEvent,
    inlineCommentCount,
    inlineReviewPublishError,
    ...generationStats,
    mergeSafetyScore: finalReport.mergeSafetyScore,
    findings: finalReport.findings,
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
    modelId: reviewModels.main,
    subagentModelId: reviewModels.subagent,
    verifierModelId: reviewModels.verifier,
    fetchedFileCount,
    filteredFileCount: filteredFiles.length,
    diffChangedLineCount,
    ...runtimeStats,
    ...generationStats,
    mergeSafetyScore: finalReport.mergeSafetyScore,
    confirmedFindings: finalReport.findings.length,
    inlineCommentCount,
    reviewId,
    reviewEvent,
    inlineReviewPublishError,
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
