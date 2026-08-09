import { Output, ToolLoopAgent, stepCountIs, tool, type ToolSet } from "ai"
import {
  buildDiffContext,
  chunksForRepositoryIndex,
  countRepositoryChunks,
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
  mainFindingSchema,
  mainReviewAgentInstructions,
  reviewChangedFileCoverageInstructions,
  reviewMainDocsInstructions,
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
  reviewDecisionOutputSchema,
  reviewDecisionSchema,
  reviewSubagentDocsInstructions,
  reviewSubagentInstructions,
  reviewSubagentOutputSchema,
  reviewVerifierDocsInstructions,
  reviewVerifierInstructions,
  reviewVerifierOutputSchema,
  reviewVerifierVerdictSchema,
  safePathSegment,
  type CandidateFinding,
  type ReviewProof,
  type ReviewReport,
} from "./prompt"
import {
  dropFindingsCoveredBy,
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
import {
  getAvailableDocLibraries,
  refreshRepositoryDocLibraries,
  type AvailableDocLibrary,
} from "../docs/service"
import { queryDocsLibrarian } from "../docs/librarian"
import { resolveDocSource, searchDocSourceChunks } from "../docs/search"
import { workerEnv as env } from "../../env"
import { prepareRepositoryContextForReview } from "./repository-context"
import { prepareReviewRuntime, serializeCodeIndexArtifact } from "./runtime"
import type { ReviewConfigValues } from "./review-config"
import { textBytes, truncateText } from "./text"

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

export type ReviewAnalysisResult = {
  kind: "analysis"
  summary?: string
  report: ReviewReport
  triggerSource: string
  modelId: string
  subagentModelId: string
  verifierModelId: string
  fetchedFileCount: number
  filteredFileCount: number
  reviewableAdditions: number
  reviewableDeletions: number
  diffChangedLineCount: number
  commentId: number
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

export type ReviewAgentResult = Omit<
  ReviewAnalysisResult,
  "kind" | "report"
> & {
  kind: "summary"
  reviewId?: number
  reviewEvent?: PullRequestReviewEvent
  inlineCommentCount?: number
  inlineReviewPublishError?: string
}

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

type QueueItem = CandidateFinding & {
  verifierVerdict: "accept" | "reject" | "escalate"
  verifierInspectionTargets: Array<{
    file: string
    startLine: number
    endLine: number
    role: ReviewProof["proofLocations"][number]["role"]
  }>
  inspectionContextIds: string[]
  unresolvedQuestion?: string
}

type MainInspectionContext = {
  id: string
  file: string
  startLine: number
  endLine: number
  content: string
}

type FindingDecision = {
  id: string
  stage: "verifier" | "main"
  decision: "reject" | "escalate" | "accept" | "failed_open"
  details: unknown
}

const validateProofLocations = ({
  proof,
  inspectedFiles,
  changedLinesByFile,
}: {
  proof: Pick<ReviewProof, "proofLocations">
  inspectedFiles: Set<string>
  changedLinesByFile: Map<string, number[]>
}) => {
  const problems: string[] = []
  for (const location of proof.proofLocations) {
    if (location.endLine < location.startLine) {
      problems.push(
        `${location.role} has an invalid range ${location.file}:${location.startLine}-${location.endLine}`
      )
    }
    if (!inspectedFiles.has(location.file)) {
      problems.push(`${location.role} cites unread file ${location.file}`)
    }
    if (location.role !== "change") continue
    const changedLines = changedLinesByFile.get(location.file) ?? []
    if (
      !changedLines.some(
        (line) => line >= location.startLine && line <= location.endLine
      )
    ) {
      problems.push(
        `change proof does not overlap a changed line at ${location.file}:${location.startLine}-${location.endLine}`
      )
    }
  }

  return problems
}

export const runReviewAnalysis = async ({
  pullRequest,
  reviewRunId,
  repository,
  reviewConfig,
  installationId,
  triggerSource,
  logger,
  preflight,
}: RunInput): Promise<ReviewAnalysisResult> => {
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
  const recordBilling = (
    stage: string,
    modelId: string,
    generation: unknown,
    options?: { retryDelaysMs?: number[] }
  ) =>
    recordLlmBilling(
      llmBilling,
      stage,
      modelId,
      generation,
      llm.provider,
      llm.resolveGenerationCost,
      options
    )
  const usages: Record<string, unknown[]> = {
    subagents: [],
    verification: [],
    claimChecks: [],
    naturalLanguageLinter: [],
    reportComposer: [],
    docsLookups: [],
  }
  const runtime = await prepareReviewRuntime({
    reviewRunId,
    repo: repository,
    pullRequest,
    installationId,
    changedFiles: filteredFiles.map((file) => file.filename),
    onIndexProgress: (progress) => {
      logger.info("Review AST index progress", {
        ...context,
        phase: progress.phase,
        status: progress.status,
        ...progress.details,
      })
      void recorder.appendEvent("ast_index.progress", progress).catch((error) =>
        logger.error("Failed to record AST index progress", {
          ...context,
          error: errorMessage(error),
        })
      )
    },
  })
  let availableDocLibraries: AvailableDocLibrary[] = []
  try {
    const detected = await refreshRepositoryDocLibraries({
      repositoryId: repository.id,
      repoDir: runtime.paths.repositoryPath,
    })
    availableDocLibraries = await getAvailableDocLibraries({
      workspaceId: repository.workspaceId,
      detected,
      excludedSlugs: repository.excludedDocLibraries ?? [],
    })
    logger.info("Doc library detection completed", {
      ...context,
      detected: detected.map((library) => library.slug),
      available: availableDocLibraries.map((library) => library.slug),
    })
  } catch (error) {
    logger.error("Doc library detection failed", {
      ...context,
      error: errorMessage(error),
    })
  }
  const parsedDiffFiles = parseUnifiedDiff(unifiedDiff)
  const changedLinesByFile = new Map<string, number[]>()
  const proofLinesByFile = new Map<string, number[]>()
  for (const diffFile of parsedDiffFiles) {
    const file =
      diffFile.newPath && diffFile.newPath !== "/dev/null"
        ? diffFile.newPath
        : diffFile.oldPath
    if (!file || file === "/dev/null" || diffFile.status === "deleted") {
      continue
    }
    const changedLines = diffFile.hunks.flatMap((hunk) => hunk.touchedNewLines)
    changedLinesByFile.set(file, [...new Set(changedLines)])
    proofLinesByFile.set(file, [
      ...new Set([
        ...changedLines,
        ...diffFile.hunks.flatMap((hunk) => hunk.anchorNewLines),
      ]),
    ])
  }
  const changedLineMap = renderChangedLineMap(changedLinesByFile)
  const diffContext = await buildDiffContext({
    repository: runtime.paths.repositoryPath,
    diffFiles: parsedDiffFiles,
  })
  const affectedSymbols = renderAffectedSymbols(diffContext)
  const semanticEnabled = Boolean(runtime.qdrant)
  const semanticRepositoryKey = `${repository.id}:${pullRequest.headSha}`
  const semanticAllChunkCount = semanticEnabled
    ? countRepositoryChunks({
        index: runtime.codeIndex,
        repositoryKey: semanticRepositoryKey,
      })
    : 0
  const semanticChangedFiles = new Set(
    filteredFiles.map((file) => file.filename)
  )
  const semanticRelatedFiles = new Set(semanticChangedFiles)
  const semanticUploadLimit = reviewAgentConfig.semanticIndex.maxUploadChunks
  if (semanticEnabled && semanticAllChunkCount > semanticUploadLimit) {
    for (const dependency of runtime.codeIndex.graph.dependencies) {
      if (semanticChangedFiles.has(dependency.from) && dependency.to) {
        semanticRelatedFiles.add(dependency.to)
      }
      if (dependency.to && semanticChangedFiles.has(dependency.to)) {
        semanticRelatedFiles.add(dependency.from)
      }
    }
    for (const edge of runtime.codeIndex.graph.edges) {
      const callerFile = edge.callSite.file
      const calleeFile = runtime.codeIndex.symbolsById.get(
        edge.calleeSymbolId
      )?.file
      if (semanticChangedFiles.has(callerFile) && calleeFile) {
        semanticRelatedFiles.add(calleeFile)
      }
      if (calleeFile && semanticChangedFiles.has(calleeFile)) {
        semanticRelatedFiles.add(callerFile)
      }
    }
  }
  const semanticScope =
    semanticAllChunkCount > semanticUploadLimit ? "related" : "repository"
  const semanticCandidateChunks = semanticEnabled
    ? semanticScope === "related"
      ? [
          ...chunksForRepositoryIndex({
            index: runtime.codeIndex,
            repositoryKey: semanticRepositoryKey,
            filePaths: semanticChangedFiles,
          }),
          ...chunksForRepositoryIndex({
            index: runtime.codeIndex,
            repositoryKey: semanticRepositoryKey,
            filePaths: [...semanticRelatedFiles].filter(
              (file) => !semanticChangedFiles.has(file)
            ),
          }),
        ]
      : chunksForRepositoryIndex({
          index: runtime.codeIndex,
          repositoryKey: semanticRepositoryKey,
        })
    : []
  const semanticChunks = semanticCandidateChunks.slice(0, semanticUploadLimit)
  const semanticSelectedFileCount = new Set(
    semanticChunks.map((chunk) => chunk.file)
  ).size
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
    astIndex: { cache: runtime.codeIndex.cache },
    semantic: {
      enabled: semanticEnabled,
      scope: semanticScope,
      repositoryChunks: semanticAllChunkCount,
      candidateChunks: semanticCandidateChunks.length,
      selectedChunks: semanticChunks.length,
      selectedFiles: semanticSelectedFileCount,
      uploadLimit: semanticUploadLimit,
      capped: semanticCandidateChunks.length > semanticChunks.length,
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
    "context/code-index.json",
    serializeCodeIndexArtifact(runtime.codeIndex)
  )
  await recorder.writeJson("context/diff-context.json", diffContext)
  await recorder.writeText("context/affected-symbols.md", affectedSymbols)
  if (semanticEnabled) {
    await recorder.appendEvent("semantic.selection", {
      scope: semanticScope,
      repositoryChunks: semanticAllChunkCount,
      candidateChunks: semanticCandidateChunks.length,
      selectedChunks: semanticChunks.length,
      selectedFiles: semanticSelectedFileCount,
      uploadLimit: semanticUploadLimit,
      capped: semanticCandidateChunks.length > semanticChunks.length,
    })
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
      chunks: semanticChunks,
      repositoryId: repository.id,
      repositoryKey: `${repository.id}:${pullRequest.headSha}`,
      headSha: pullRequest.headSha,
      reviewRunId,
      qdrant: runtime.qdrant,
      onProgress: (progress) => {
        logger.info("Review semantic index progress", {
          ...context,
          ...progress,
        })
        void recorder
          .appendEvent("semantic.write.progress", progress)
          .catch((error) =>
            logger.error("Failed to record semantic index progress", {
              ...context,
              error: errorMessage(error),
            })
          )
      },
    })
    qdrantChunks = indexResult.chunks
    qdrantIndexedFiles = indexResult.indexedFiles
    qdrantIgnoredFiles = indexResult.ignoredFiles
    qdrantLogicalWriteBytes = indexResult.logicalWriteBytes
  }
  const runtimeStats = {
    repositoryPath: runtime.paths.repositoryPath,
    diagnostics: runtime.codeIndex.diagnostics.length,
    astCache: runtime.codeIndex.cache,
    semanticEnabled,
    semanticScope,
    semanticRepositoryChunks: semanticAllChunkCount,
    semanticSelectedChunks: semanticChunks.length,
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
    onFileRead?: (file: string) => void,
    onUse?: () => void
  ) => {
    const base = {
      read_patch: tool({
        description:
          "Read a changed-file patch. Returns at most 12 KB by default; request up to 40 KB when the omitted patch is required.",
        inputSchema: z.object({
          file: z.string().min(1),
          maxBytes: z.number().int().min(2_000).max(40_000).optional(),
        }),
        execute: async ({ file, maxBytes = 12_000 }) => {
          onUse?.()
          const entry = filteredFiles.find((item) => item.filename === file)
          const omitted = omittedFiles.find((item) => item.filename === file)
          const output = entry
            ? {
                file,
                patch: truncateText(
                  serializePullRequestFiles([entry]),
                  maxBytes
                ),
              }
            : omitted
              ? { file, patch: omitted.omittedReason ?? "Patch omitted." }
              : {
                  file,
                  error:
                    "Not a changed file in this pull request. Use an exact repository-relative path from the changed-line map.",
                }
          await recorder.recordToolCall({
            name: `${scope}.read_patch`,
            input: { file, maxBytes },
            output,
          })
          return output
        },
      }),
      read_file: tool({
        description:
          "Read numbered repository lines. Reads 120 lines by default and up to 800. Request a larger maxLines only when the next range is required.",
        inputSchema: z.object({
          file: z.string().min(1),
          startLine: z.number().int().positive().optional(),
          maxLines: z.number().int().positive().max(800).optional(),
        }),
        execute: async ({ file, startLine, maxLines = 120 }) => {
          onUse?.()
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
          "Get symbol definitions, locations, and bounded source. Returns 3 definitions by default; use offset, limit, or maxSourceBytes to request more.",
        inputSchema: z.object({
          symbol: z.string().min(1),
          offset: z.number().int().nonnegative().optional(),
          limit: z.number().int().positive().max(20).optional(),
          maxSourceBytes: z
            .number()
            .int()
            .min(1_000)
            .max(40_000)
            .optional(),
        }),
        execute: async ({ symbol, offset, limit, maxSourceBytes }) => {
          onUse?.()
          const input = { symbol, offset, limit, maxSourceBytes }
          const result = await getSymbolDefinition({
            repository: runtime.paths.repositoryPath,
            index: runtime.codeIndex,
            symbol,
            offset,
            limit,
            maxSourceBytes,
          })
          for (const definition of result.json.definitions) {
            if (definition.source) onFileRead?.(definition.file)
          }
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
        description:
          "Get direct callers in pages. Returns 8 callers by default; use offset and limit to request more.",
        inputSchema: z.object({
          symbol: z.string().min(1),
          offset: z.number().int().nonnegative().max(199).optional(),
          limit: z.number().int().positive().max(50).optional(),
        }),
        execute: async ({ symbol, offset, limit }) => {
          onUse?.()
          const input = { symbol, offset, limit }
          const result = await getSymbolCallers({
            repository: runtime.paths.repositoryPath,
            index: runtime.codeIndex,
            symbol,
            offset,
            limit,
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
        description:
          "Search exact text across repository files. Returns 12 matches by default; request up to 50 with limit.",
        inputSchema: z.object({
          query: z.string().min(1),
          limit: z.number().int().positive().max(50).optional(),
        }),
        execute: async ({ query, limit = 12 }) => {
          onUse?.()
          const result = await searchRepositoryText({
            repository: runtime.paths.repositoryPath,
            index: runtime.codeIndex,
            query,
            maxResults: limit,
          })
          const output = {
            ...result.stats,
            markdown: truncateText(result.markdown, 12_000),
          }
          await recorder.recordToolCall({
            name: `${scope}.locate_text`,
            input: { query, limit },
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
          maxBytes: z.number().int().min(2_000).max(40_000).optional(),
        }),
        execute: async ({ query, limit = 6, maxBytes = 12_000 }) => {
          onUse?.()
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
            markdown: truncateText(result.markdown, maxBytes),
          }
          await recorder.recordToolCall({
            name: `${scope}.search_code`,
            input: { query, limit, maxBytes },
            output,
          })
          return output
        },
      }),
    }
  }

  const lowerUnifiedDiff = unifiedDiff.toLowerCase()
  const diffDocLibraries = availableDocLibraries.filter((library) =>
    library.matchTerms.some((term) => lowerUnifiedDiff.includes(term))
  )
  const docSourceCache = new Map<
    string,
    { id: string; activeCrawlId: string } | null
  >()
  const resolveDocSourceCached = async (library: string) => {
    if (docSourceCache.has(library)) return docSourceCache.get(library)!
    const source = await resolveDocSource(
      library,
      repository.workspaceId
    ).catch(() => null)
    const resolved =
      source?.activeCrawlId != null
        ? { id: source.id, activeCrawlId: source.activeCrawlId }
        : null
    docSourceCache.set(library, resolved)
    return resolved
  }

  const librarySlugEnum = (libraries: AvailableDocLibrary[]) =>
    z.enum(libraries.map((library) => library.slug) as [string, ...string[]])

  const createDocsSearchTool = (scope: string): ToolSet => {
    if (diffDocLibraries.length === 0) return {}
    return {
      search_docs: tool({
        description: `Full-text search across the indexed documentation of libraries this pull request uses (${diffDocLibraries.map((library) => library.name).join(", ")}). Returns matching sections (url, heading, snippet). Best for documented behavior: API names, defaults, error handling, return shapes.`,
        inputSchema: z.object({
          library: librarySlugEnum(diffDocLibraries),
          query: z.string().min(1).max(200),
          limit: z.number().int().positive().max(10).optional(),
          maxWords: z.number().int().min(20).max(100).optional(),
        }),
        execute: async ({ library, query, limit = 4, maxWords = 40 }) => {
          let output: { results: unknown[]; note?: string }
          try {
            const source = await resolveDocSourceCached(library)
            if (!source) {
              output = { results: [], note: "documentation unavailable" }
            } else {
              const results = await searchDocSourceChunks({
                sourceId: source.id,
                activeCrawlId: source.activeCrawlId,
                query,
                limit,
                maxFragments: 1,
                maxWords,
              })
              output =
                results.length > 0
                  ? { results }
                  : { results: [], note: "no matches; try different terms" }
            }
          } catch {
            output = { results: [], note: "documentation search failed" }
          }
          await recorder.recordToolCall({
            name: `${scope}.search_docs`,
            input: { library, query, limit, maxWords },
            output,
          })
          return output
        },
      }),
    }
  }

  const DOCS_LOOKUP_BUDGET = 4
  const docsLibrarianModelId =
    env.DOCS_LIBRARIAN_MODEL ?? env.REVIEW_VERIFIER_MODEL
  let docsLookupsUsed = 0
  type DocsLookupOutput = {
    found: boolean
    answer: string
    citations: Array<{ url: string; title: string; excerpt: string }>
  }
  const docsLookupCache = new Map<
    string,
    DocsLookupOutput
  >()
  const limitDocsLookupOutput = (
    output: DocsLookupOutput,
    maxAnswerBytes: number,
    citationLimit: number
  ) => ({
    ...output,
    answer: truncateText(output.answer, maxAnswerBytes),
    citations: output.citations.slice(0, citationLimit).map((citation) => ({
      ...citation,
      excerpt: truncateText(citation.excerpt, 1_500),
    })),
    moreCitations: output.citations.length > citationLimit,
  })
  const createDocsLookupTool = (scope: string): ToolSet => {
    if (availableDocLibraries.length === 0) return {}
    return {
      lookup_docs: tool({
        description: `Answer one focused question about the documented behavior of a library this repository uses (${availableDocLibraries.map((library) => library.name).join(", ")}), with citations. Slow and budgeted per review - ask one specific question about API behavior, defaults, or semantics that decides a verdict.`,
        inputSchema: z.object({
          library: librarySlugEnum(availableDocLibraries),
          question: z.string().min(1).max(500),
          maxAnswerBytes: z
            .number()
            .int()
            .min(2_000)
            .max(20_000)
            .optional(),
          citationLimit: z.number().int().positive().max(10).optional(),
        }),
        execute: async ({
          library,
          question,
          maxAnswerBytes = 6_000,
          citationLimit = 4,
        }) => {
          const cacheKey = `${library}::${question.trim().toLowerCase()}`
          const cached = docsLookupCache.get(cacheKey)
          if (cached) {
            return limitDocsLookupOutput(
              cached,
              maxAnswerBytes,
              citationLimit
            )
          }
          if (docsLookupsUsed >= DOCS_LOOKUP_BUDGET) {
            return {
              found: false,
              answer:
                "Documentation lookup budget for this review is exhausted. Decide from repository evidence.",
              citations: [],
            }
          }
          docsLookupsUsed += 1
          let output: DocsLookupOutput
          let lookupFailed = false
          try {
            const result = await queryDocsLibrarian({
              library,
              question,
              workspaceId: repository.workspaceId,
            })
            if (result.usage) {
              usages.docsLookups!.push(result.usage)
              await recordBilling(
                "docs_lookup",
                docsLibrarianModelId,
                result.generation ?? { totalUsage: result.usage }
              )
            }
            output = {
              found: result.found,
              answer: result.answer,
              citations: result.citations.map(({ url, title, excerpt }) => ({
                url,
                title,
                excerpt,
              })),
            }
          } catch (error) {
            lookupFailed = true
            output = {
              found: false,
              answer: `Documentation lookup failed: ${errorMessage(error)}`,
              citations: [],
            }
          }
          if (!lookupFailed) docsLookupCache.set(cacheKey, output)
          const limitedOutput = limitDocsLookupOutput(
            output,
            maxAnswerBytes,
            citationLimit
          )
          await recorder.recordToolCall({
            name: `${scope}.lookup_docs`,
            input: {
              library,
              question,
              maxAnswerBytes,
              citationLimit,
            },
            output: limitedOutput,
          })
          await recorder.appendEvent("docs.lookup", {
            scope,
            library,
            found: output.found,
            used: docsLookupsUsed,
            budget: DOCS_LOOKUP_BUDGET,
          })
          return limitedOutput
        },
      }),
    }
  }

  const allCandidateIds = new Set<string>()
  const candidatesById = new Map<string, CandidateFinding>()
  const discoveredCandidates: CandidateFinding[] = []
  const mainQueue: QueueItem[] = []
  let verifierAcceptedCount = 0
  const findingDecisions: FindingDecision[] = []
  const savedMainDecisions = new Map<
    string,
    z.infer<typeof reviewDecisionOutputSchema>
  >()
  const retriedUnresolvedRejections = new Set<string>()
  const claimCheckSchema = z.object({
    sameClaim: z.boolean(),
    difference: z.string(),
  })
  let claimCheckCount = 0
  const publicQueueItem = ({
    taskId: _taskId,
    verifierVerdict: _verifierVerdict,
    ...item
  }: QueueItem) => item
  const subagentCoveredFiles = new Set<string>()
  const getUncoveredChangedFiles = () =>
    filteredFiles
      .filter(
        (file) =>
          file.status !== "removed" && !isLikelyGeneratedFile(file.filename)
      )
      .map((file) => file.filename)
      .filter((file) => !subagentCoveredFiles.has(file))
  let subagentRunStarted = false
  let subagentCallCount = 0
  let subagentWaveCount = 0
  const mainInspectedFiles = new Set<string>()
  let mainRepositoryToolCalls = 0
  let mainPatchReads = 0

  const buildMainInspectionContext = async (items: QueueItem[]) => {
    const contextEntries: MainInspectionContext[] = []
    const itemsById = new Map(items.map((item) => [item.id, item]))

    const ranges = items
      .flatMap((item) =>
        item.verifierInspectionTargets.map((target) => ({
          file: target.file,
          startLine: Math.max(1, target.startLine - 6),
          endLine: target.endLine + 6,
          candidateIds: new Set([item.id]),
        }))
      )
      .sort((a, b) => a.file.localeCompare(b.file) || a.startLine - b.startLine)
    const merged: typeof ranges = []
    for (const range of ranges) {
      const previous = merged.at(-1)
      const mergedEnd = previous
        ? Math.max(previous.endLine, range.endLine)
        : range.endLine
      if (
        previous &&
        previous.file === range.file &&
        range.startLine <= previous.endLine + 1 &&
        mergedEnd - previous.startLine < 60
      ) {
        previous.endLine = mergedEnd
        for (const id of range.candidateIds) previous.candidateIds.add(id)
      } else {
        merged.push(range)
      }
    }

    for (const range of merged) {
      try {
        const excerpt = await readRepositoryFile({
          repository: runtime.paths.repositoryPath,
          file: range.file,
          startLine: range.startLine,
          maxLines: range.endLine - range.startLine + 1,
        })
        const id = `code:${range.file}:${excerpt.startLine}-${excerpt.endLine}`
        contextEntries.push({
          id,
          file: range.file,
          startLine: excerpt.startLine,
          endLine: excerpt.endLine,
          content: truncateText(excerpt.content, 4_000),
        })
        mainInspectedFiles.add(range.file)
        for (const candidateId of range.candidateIds) {
          itemsById.get(candidateId)?.inspectionContextIds.push(id)
        }
      } catch (error) {
        await recorder.appendEvent("main.inspection_context.failed", {
          file: range.file,
          startLine: range.startLine,
          endLine: range.endLine,
          error: errorMessage(error),
        })
      }
    }

    return contextEntries
  }

  const checkAcceptedClaim = async (
    candidate: CandidateFinding,
    decision: z.infer<typeof reviewDecisionOutputSchema>
  ) => {
    claimCheckCount += 1
    const agent = new ToolLoopAgent({
      model: agentLayers.composer.model,
      instructions: `Compare two bug claims. Do not judge whether either claim is correct.

Return sameClaim=true only when both claims have the same root cause, trigger, and adverse result. Different wording, detail, and severity are allowed. Return false when the accepted proof changes the exception, mechanism, trigger, or result. Keep difference short.`,
      tools: {},
      providerOptions: agentLayers.composer.providerOptions,
      output: repairedJsonOutput(
        Output.object({
          schema: claimCheckSchema,
          name: "claim_check",
          description:
            "Whether an accepted proof preserves the candidate claim",
        })
      ),
      stopWhen: stepCountIs(1),
      maxRetries: 2,
      onStepFinish: async (step) => recorder.recordStep(step),
    })
    const generation = await agent.generate({
      prompt: `Original candidate:
Title: ${candidate.title}
Body: ${candidate.body}

Accepted proof:
Entry path: ${decision.entryPath}
Actual result: ${decision.actualResult}
Pull-request evidence: ${decision.prChangeEvidence}
Usefulness: ${decision.usefulness}`,
    })
    usages.claimChecks!.push(generation.totalUsage)
    await recordBilling("claim_check", agentLayers.composer.modelId, generation)
    const output = claimCheckSchema.parse(generation.output)
    await recorder.writeJson(
      `claim-check/${String(claimCheckCount).padStart(2, "0")}-${safePathSegment(candidate.id)}.json`,
      {
        candidate: {
          id: candidate.id,
          title: candidate.title,
          body: candidate.body,
        },
        decision,
        output,
        usage: generation.totalUsage,
      }
    )
    return output
  }

  const runVerifier = async (candidate: CandidateFinding) => {
    const safeId = safePathSegment(candidate.id)
    const inspectedFiles = new Set<string>()
    const verdictSchema = reviewVerifierVerdictSchema
      .refine(
        (output) => output.id === candidate.id,
        `Return the verdict for ${candidate.id}.`
      )
      .superRefine((output, validation) => {
        const problems = validateProofLocations({
          proof: output,
          inspectedFiles,
          changedLinesByFile: proofLinesByFile,
        })
        if (problems.length > 0) {
          validation.addIssue({
            code: "custom",
            path: ["proofLocations"],
            message: `Proof must cite inspected code and a pull-request change. Problems: ${problems.join(", ")}.`,
          })
        }
      })
    const prompt = buildReviewVerifierPrompt({
      title: pullRequest.title,
      body: pullRequest.body,
      baseRef: pullRequest.baseRef,
      headRef: pullRequest.headRef,
      changedLineMap,
      candidatePatch: truncateText(
        serializePullRequestFiles(
          filteredFiles.filter((file) => file.filename === candidate.file)
        ) || "Patch unavailable."
      ),
      candidate,
    })
    await recorder.writeText(`verifier/${safeId}/prompt.txt`, prompt)
    logger.info("Review finding verification started", {
      ...context,
      findingId: candidate.id,
      file: candidate.file,
      title: candidate.title,
    })
    let lastError: unknown
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const attemptSteps: unknown[] = []
      inspectedFiles.clear()
      try {
        const agent = new ToolLoopAgent({
          model: agentLayers.verifier.model,
          instructions:
            availableDocLibraries.length > 0
              ? `${reviewVerifierInstructions}${reviewVerifierDocsInstructions}`
              : reviewVerifierInstructions,
          tools: {
            ...createRepositoryTools(`verifier.${safeId}.${attempt}`, (file) =>
              inspectedFiles.add(file)
            ),
            ...createDocsLookupTool(`verifier.${safeId}.${attempt}`),
          },
          providerOptions: agentLayers.verifier.providerOptions,
          output: repairedJsonOutput(
            Output.object({
              schema: reviewVerifierOutputSchema,
              name: "verified_finding",
              description: "One evidence-backed verdict for one finding",
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
        const verdict = verdictSchema.parse(generation.output)
        await recorder.writeJson(`verifier/${safeId}/attempt-${attempt}.json`, {
          finishReason: generation.finishReason,
          usage: generation.totalUsage,
          inspectedFiles: [...inspectedFiles],
          output: verdict,
        })
        logger.info("Review finding verification completed", {
          ...context,
          findingId: candidate.id,
          verdict: verdict.verdict,
          ...(verdict.verdict === "accept"
            ? { usefulness: verdict.usefulness }
            : {}),
          attempt,
        })
        return verdict
      } catch (error) {
        lastError = error
        if (attemptSteps.length > 0) {
          await recordBilling("verification", agentLayers.verifier.modelId, {
            steps: attemptSteps,
          })
        }
        await recorder.writeJson(
          `verifier/${safeId}/attempt-${attempt}-error.json`,
          { error }
        )
        await recorder.appendEvent("verifier.attempt.failed", {
          id: candidate.id,
          attempt,
          error: errorMessage(error),
        })
      }
    }
    const reason = `Verifier failed open: ${errorMessage(lastError)}`
    await recorder.appendEvent("verifier.failed_open", {
      id: candidate.id,
      error: reason,
    })
    return {
      id: candidate.id,
      verdict: "escalate" as const,
      pullRequestRelevance: "",
      unresolvedQuestion: reason,
      knownFacts: "No verifier result was produced.",
      locations: [],
      failedOpen: true,
    }
  }

  const spawnReviewAgents = tool({
    description:
      "Run focused discovery tasks one at a time. Set only the code area for each task. Every task receives a compact list of findings from earlier tasks and calls. The result lists changed files that no discovery agent has read yet.",
    inputSchema: z.object({
      tasks: z
        .array(
          z.object({
            id: z.string().min(1),
            area: z
              .string()
              .min(1)
              .max(200)
              .describe(
                "Only the changed flow, component, or connected code area to explore. Do not include review or output instructions."
              ),
          })
        )
        .min(1)
        .max(8)
        .refine(
          (tasks) =>
            new Set(tasks.map((task) => task.id)).size === tasks.length,
          "Task IDs must be unique"
        ),
    }),
    execute: async ({ tasks }) => {
      if (!subagentRunStarted && mainPatchReads === 0) {
        throw new Error(
          "Read at least one changed-file patch before launching review agents."
        )
      }
      if (!subagentRunStarted && mainRepositoryToolCalls === 0) {
        throw new Error(
          "Inspect connected repository code before launching review agents."
        )
      }
      subagentRunStarted = true
      subagentCallCount += 1
      const call = subagentCallCount
      await recorder.appendEvent("subagents.run.started", {
        call,
        tasks: tasks.map((task) => task.id),
        concurrency: reviewAgentConfig.subagent.concurrency,
        mainInspection: {
          patchReads: mainPatchReads,
          repositoryToolCalls: mainRepositoryToolCalls,
          files: [...mainInspectedFiles],
        },
      })
      logger.info("Review discovery started", {
        ...context,
        call,
        tasks: tasks.map((task) => task.id),
        earlierFindings: discoveredCandidates.length,
        mainInspectedFiles: mainInspectedFiles.size,
      })
      const sharedContext = `Pull request title: ${pullRequest.title}
Pull request description: ${pullRequest.body ?? "(none)"}
Base branch: ${pullRequest.baseRef}
Head branch: ${pullRequest.headRef}

Changed files:
${diff}

Changed symbol index:
${affectedSymbols}`

      type TaskResult = {
        wave: number
        taskId: string
        candidates: CandidateFinding[]
        error?: string
      }
      const runTask = async ({
        task,
        taskIndex,
        wave,
        earlierFindings,
      }: {
        task: { id: string; area: string }
        taskIndex: number
        wave: number
        earlierFindings: CandidateFinding[]
      }): Promise<TaskResult> => {
        const safeId = `${String(taskIndex + 1).padStart(2, "0")}-${safePathSegment(task.id)}`
        const priorFindingsContext =
          earlierFindings.length > 0
            ? `

Findings already reported by subagents in earlier waves:
${JSON.stringify(
  earlierFindings.map((finding) => ({
    id: finding.id,
    title: finding.title,
    file: finding.file,
    startLine: finding.startLine,
    endLine: finding.endLine,
  })),
  null,
  2
)}

Do not repeat the same bug. These locations are not covered or safe merely because one finding exists there. Re-inspect them for different defects.`
            : ""
        const prompt = `${sharedContext}${priorFindingsContext}

Area to explore:
${task.area}`
        await recorder.writeText(
          `subagents/wave-${wave}/${safeId}/prompt.txt`,
          prompt
        )
        let lastError: unknown
        const taskReadFiles = new Set<string>()
        for (let attempt = 1; attempt <= 2; attempt += 1) {
          const attemptSteps: unknown[] = []
          try {
            const agent = new ToolLoopAgent({
              model: agentLayers.subagent.model,
              instructions:
                diffDocLibraries.length > 0
                  ? `${reviewSubagentInstructions}${reviewSubagentDocsInstructions}`
                  : reviewSubagentInstructions,
              tools: {
                ...createRepositoryTools(
                  `subagent.${wave}.${safeId}.${attempt}`,
                  (file) => taskReadFiles.add(file)
                ),
                ...createDocsSearchTool(
                  `subagent.${wave}.${safeId}.${attempt}`
                ),
              },
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
              const id = `w${wave}:${task.id}:${index + 1}`
              allCandidateIds.add(id)
              const candidate = {
                ...finding,
                startLine: Math.min(finding.startLine, finding.endLine),
                endLine: Math.max(finding.startLine, finding.endLine),
                id,
                taskId: task.id,
                supportingTaskIds: [task.id],
              } satisfies CandidateFinding
              candidatesById.set(id, candidate)
              return candidate
            })
            await recorder.writeJson(
              `subagents/wave-${wave}/${safeId}/attempt-${attempt}.json`,
              {
                finishReason: generation.finishReason,
                usage: generation.totalUsage,
                output,
              }
            )
            await recorder.appendEvent("subagent.completed", {
              wave,
              taskId: task.id,
              attempt,
              findings: candidates.length,
            })
            for (const file of taskReadFiles) {
              subagentCoveredFiles.add(file)
            }
            return { wave, taskId: task.id, candidates }
          } catch (error) {
            lastError = error
            if (attemptSteps.length > 0) {
              await recordBilling("subagents", agentLayers.subagent.modelId, {
                steps: attemptSteps,
              })
            }
            await recorder.writeJson(
              `subagents/wave-${wave}/${safeId}/attempt-${attempt}-error.json`,
              { error }
            )
            await recorder.appendEvent("subagent.attempt.failed", {
              wave,
              taskId: task.id,
              attempt,
              error: errorMessage(error),
            })
          }
        }
        return {
          wave,
          taskId: task.id,
          candidates: [],
          error: errorMessage(lastError),
        }
      }

      const taskResults: TaskResult[] = []
      const rawCandidates: CandidateFinding[] = []
      const taskWaves = chunked(tasks, reviewAgentConfig.subagent.concurrency)
      for (const waveTasks of taskWaves) {
        subagentWaveCount += 1
        const wave = subagentWaveCount
        const earlierFindings = [...discoveredCandidates]
        await recorder.appendEvent("subagents.wave.started", {
          call,
          wave,
          tasks: waveTasks.map((task) => task.id),
          earlierFindings: earlierFindings.map((finding) => finding.id),
        })
        logger.info("Review discovery task started", {
          ...context,
          call,
          wave,
          tasks: waveTasks.map((task) => task.id),
          earlierFindings: earlierFindings.length,
        })
        const waveResults = await mapConcurrent(
          waveTasks,
          reviewAgentConfig.subagent.concurrency,
          (task) =>
            runTask({
              task,
              taskIndex: tasks.indexOf(task),
              wave,
              earlierFindings,
            })
        )
        taskResults.push(...waveResults)
        const waveCandidates = waveResults.flatMap(
          (result) => result.candidates
        )
        rawCandidates.push(...waveCandidates)
        discoveredCandidates.push(...waveCandidates)
        await recorder.appendEvent("subagents.wave.completed", {
          call,
          wave,
          tasks: waveTasks.map((task) => task.id),
          findings: waveCandidates.length,
        })
        logger.info("Review discovery task completed", {
          ...context,
          call,
          wave,
          findings: waveCandidates.length,
          totalFindings: discoveredCandidates.length,
        })
      }
      const uncoveredFiles = getUncoveredChangedFiles()

      const verdicts = await mapConcurrent(
        rawCandidates,
        reviewAgentConfig.verifier.concurrency,
        runVerifier
      )
      const counts = { accept: 0, reject: 0, escalate: 0 }
      const newQueue: QueueItem[] = []
      for (const [index, verdict] of verdicts.entries()) {
        const candidate = rawCandidates[index]!
        counts[verdict.verdict] += 1
        findingDecisions.push({
          id: verdict.id,
          stage: "verifier",
          decision:
            "failedOpen" in verdict && verdict.failedOpen
              ? "failed_open"
              : verdict.verdict,
          details: verdict,
        })
        if (verdict.verdict === "accept") {
          verifierAcceptedCount += 1
        }
        const verifierInspectionTargets =
          "proofLocations" in verdict
            ? [
                ...new Map(
                  verdict.proofLocations.map(
                    ({ file, startLine, endLine, role }) => [
                      `${file}:${startLine}:${endLine}`,
                      { file, startLine, endLine, role },
                    ]
                  )
                ).values(),
              ]
            : []
        const item: QueueItem = {
          ...candidate,
          verifierVerdict: verdict.verdict,
          verifierInspectionTargets,
          inspectionContextIds: [],
          ...(verdict.verdict === "escalate"
            ? { unresolvedQuestion: verdict.unresolvedQuestion }
            : {}),
        }
        newQueue.push(item)
      }
      newQueue.sort(
        (a, b) =>
          a.file.localeCompare(b.file) ||
          a.startLine - b.startLine ||
          a.id.localeCompare(b.id)
      )
      const inspectionContext = await buildMainInspectionContext(newQueue)
      mainQueue.push(...newQueue)

      const output = {
        tasks: taskResults.map((result) =>
          result.error
            ? { wave: result.wave, taskId: result.taskId, error: result.error }
            : {
                wave: result.wave,
                taskId: result.taskId,
                findings: result.candidates.length,
              }
        ),
        reviewQueue: newQueue.map(publicQueueItem),
        inspectionContext,
        uncoveredFiles,
        stats: {
          call,
          waves: taskWaves.length,
          totalWaves: subagentWaveCount,
          concurrency: reviewAgentConfig.subagent.concurrency,
          rawFindings: rawCandidates.length,
          verified: rawCandidates.length,
          accepted: counts.accept,
          rejected: counts.reject,
          escalated: counts.escalate,
          queuedForMainReview: rawCandidates.length,
          totalQueuedForMainReview: mainQueue.length,
          uncoveredFiles: uncoveredFiles.length,
        },
      }
      await recorder.writeJson(`subagents/call-${call}/result.json`, {
        ...output,
        verifierResults: verdicts,
      })
      await recorder.writeJson("subagents/result.json", {
        calls: subagentCallCount,
        waves: subagentWaveCount,
        candidates: discoveredCandidates,
        reviewQueue: mainQueue,
      })
      await recorder.recordToolCall({
        name: "main.spawn_review_agents",
        input: { tasks },
        output,
      })
      await recorder.appendEvent("subagents.run.completed", {
        ...output.stats,
      })
      logger.info("Review discovery and verification completed", {
        ...context,
        ...output.stats,
        uncoveredFiles,
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
          generation,
          {
            retryDelaysMs: [
              250, 500, 1_000, 2_000, 4_000, 8_000, 16_000, 30_000,
            ],
          }
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
      "Read a changed-file patch. Returns at most 12 KB by default; request up to 40 KB when the omitted patch is required.",
    inputSchema: z.object({
      file: z.string().min(1),
      maxBytes: z.number().int().min(2_000).max(40_000).optional(),
    }),
    execute: async ({ file, maxBytes = 12_000 }) => {
      const entry = patchesByFile.get(file)
      const omitted = omittedByFile.get(file)
      if (entry || omitted) {
        mainPatchReads += 1
        mainInspectedFiles.add(file)
      }
      const output = entry
        ? {
            file,
            patch: truncateText(serializePullRequestFiles([entry]), maxBytes),
          }
        : omitted
          ? { file, patch: omitted.omittedReason ?? "Patch omitted." }
          : {
              file,
              error:
                "Not a changed file in this pull request. Use the exact repository-relative path from the changed files overview.",
            }
      await recorder.recordToolCall({
        name: "main.read_patch",
        input: { file, maxBytes },
        output,
      })
      return output
    },
  })
  const saveReviewDecisions = tool({
    description:
      "Validate and save one or more final candidate decisions. Submit related queue items together in queue order.",
    inputSchema: z.object({
      decisions: z.array(reviewDecisionOutputSchema).min(1),
    }),
    execute: async ({ decisions }) => {
      const pending = mainQueue.filter(
        (item) => !savedMainDecisions.has(item.id)
      )
      const expectedIds = pending
        .slice(0, decisions.length)
        .map((item) => item.id)
      if (
        decisions.length > pending.length ||
        decisions.some((decision, index) => decision.id !== expectedIds[index])
      ) {
        return {
          savedIds: [],
          errors: [
            {
              id: decisions[0]?.id ?? "",
              error: `Submit the next queue items in order: ${expectedIds.join(", ")}`,
            },
          ],
          remainingIds: pending.map((item) => item.id),
        }
      }

      const savedIds: string[] = []
      const errors: Array<{ id: string; error: string }> = []
      for (const [index, input] of decisions.entries()) {
        const current = pending[index]!
        const parsed = reviewDecisionSchema.safeParse(input)
        const problems = parsed.success
          ? validateProofLocations({
              proof: parsed.data,
              inspectedFiles: mainInspectedFiles,
              changedLinesByFile: proofLinesByFile,
            })
          : parsed.error.issues.map((issue) => issue.message)
        if (!parsed.success || problems.length > 0) {
          errors.push({ id: input.id, error: problems.join("; ") })
          continue
        }

        const decision = parsed.data
        if (
          decision.decision === "reject" &&
          decision.rejectionBasis === "unresolved" &&
          current.verifierVerdict === "accept" &&
          !retriedUnresolvedRejections.has(decision.id)
        ) {
          retriedUnresolvedRejections.add(decision.id)
          const targets = current.verifierInspectionTargets
            .map(
              ({ file, startLine, endLine, role }) =>
                `${role}: ${file}:${startLine}-${endLine}`
            )
            .join(", ")
          await recorder.appendEvent("main.decision.unresolved_retry", {
            id: decision.id,
            inspectionContextIds: current.inspectionContextIds,
            verifierInspectionTargets: current.verifierInspectionTargets,
          })
          errors.push({
            id: decision.id,
            error: `This rejection is unresolved, not disproved. Make one focused check using candidate contexts ${current.inspectionContextIds.join(", ")} and these untrusted locations: ${targets || "none"}. Then resubmit accept, contradicted reject, or unresolved reject.`,
          })
          continue
        }
        if (decision.decision === "accept") {
          const claimCheck = await checkAcceptedClaim(current, decision)
          if (!claimCheck.sameClaim) {
            await recorder.appendEvent("main.decision.claim_changed", {
              id: decision.id,
              difference: claimCheck.difference,
            })
            logger.info("Main review decision changed the candidate claim", {
              ...context,
              id: decision.id,
              difference: claimCheck.difference,
            })
            errors.push({
              id: decision.id,
              error: `Acceptance changes the candidate claim: ${claimCheck.difference}. Reject the original candidate and send the different claim through follow-up discovery.`,
            })
            continue
          }
        }

        savedMainDecisions.set(decision.id, decision)
        findingDecisions.push({
          id: decision.id,
          stage: "main",
          decision: decision.decision,
          details: decision,
        })
        savedIds.push(decision.id)
        await recorder.appendEvent("main.decision.saved", {
          id: decision.id,
          decision: decision.decision,
        })
      }

      await recorder.writeJson("finding-decisions.json", findingDecisions)
      const remainingIds = mainQueue
        .filter((item) => !savedMainDecisions.has(item.id))
        .map((item) => item.id)
      logger.info("Main review decisions saved", {
        ...context,
        savedIds,
        failedIds: errors.map((error) => error.id),
        completed: savedMainDecisions.size,
        total: mainQueue.length,
        remaining: remainingIds.length,
      })
      return { savedIds, errors, remainingIds }
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
  const mainResponseSchema = mainReviewReportSchema.extend({
    findings: z.array(mainFindingSchema),
  })
  const mainOutputSchema = mainResponseSchema.superRefine(
    (output, validation) => {
      const problems: string[] = []
      const sourceCounts = new Map<string, number>()
      for (const [findingIndex, finding] of output.findings.entries()) {
        if (!mainInspectedFiles.has(finding.file)) {
          problems.push(
            `finding ${findingIndex} uses ${finding.file}, which the main agent did not read`
          )
        }
        const uniqueSources = new Set(finding.sourceCandidateIds)
        if (uniqueSources.size !== finding.sourceCandidateIds.length) {
          problems.push(
            `finding ${findingIndex} has duplicate sourceCandidateIds`
          )
        }
        for (const id of uniqueSources) {
          const decision = savedMainDecisions.get(id)
          if (!decision || decision.decision !== "accept") {
            problems.push(
              `finding ${findingIndex} source ${id} was not accepted`
            )
          }
          sourceCounts.set(id, (sourceCounts.get(id) ?? 0) + 1)
        }
      }
      for (const decision of savedMainDecisions.values()) {
        if (decision.decision !== "accept") continue
        if (sourceCounts.get(decision.id) !== 1) {
          problems.push(`accepted ${decision.id} must map to one finding`)
        }
      }
      if (problems.length > 0) {
        validation.addIssue({
          code: "custom",
          path: ["findings"],
          message: problems.join(", "),
        })
      }
    }
  )
  let submittedMainReport: z.infer<typeof mainResponseSchema> | undefined
  const submitReviewReport = tool({
    description:
      "Validate and save the final review report. Fix the returned errors and submit again until it is saved.",
    inputSchema: mainResponseSchema,
    execute: async (report) => {
      const missingDecisionIds = mainQueue
        .filter((item) => !savedMainDecisions.has(item.id))
        .map((item) => item.id)
      if (missingDecisionIds.length > 0) {
        return {
          saved: false,
          errors: [
            `Save decisions before submitting the report: ${missingDecisionIds.join(", ")}`,
          ],
        }
      }

      const parsed = mainOutputSchema.safeParse(report)
      if (!parsed.success) {
        const errors = parsed.error.issues.map((issue) => issue.message)
        await recorder.appendEvent("main.report.rejected", { errors })
        return { saved: false, errors }
      }

      submittedMainReport = parsed.data
      await recorder.appendEvent("main.report.saved", {
        findings: parsed.data.findings.length,
      })
      return { saved: true }
    },
  })
  const mainCompletionSchema = z.object({ completed: z.boolean() })
  const mainAgent = new ToolLoopAgent({
    model: agentLayers.main.model,
    instructions: `${mainReviewAgentInstructions}${
      reviewAgentConfig.subagent.requireCompleteFileCoverage
        ? reviewChangedFileCoverageInstructions
        : ""
    }${availableDocLibraries.length > 0 ? reviewMainDocsInstructions : ""}`,
    tools: {
      ...createRepositoryTools(
        "main",
        (file) => mainInspectedFiles.add(file),
        () => {
          mainRepositoryToolCalls += 1
        }
      ),
      read_patch: readPatch,
      spawn_review_agents: spawnReviewAgents,
      save_review_decisions: saveReviewDecisions,
      submit_review_report: submitReviewReport,
      ...createDocsLookupTool("main"),
    },
    providerOptions: agentLayers.main.providerOptions,
    output: repairedJsonOutput(
      Output.object({
        schema: mainCompletionSchema,
        name: "review_complete",
        description: "Confirmation that a valid review report was submitted",
      })
    ),
    stopWhen: stepCountIs(reviewAgentConfig.main.maxSteps),
    maxRetries: 2,
    onStepFinish: async (step) => recorder.recordStep(step),
  })

  const composedReportPromise = runReportComposer()
  const mainGeneration = await mainAgent.generate({ prompt: mainPrompt })
  const mainUsage = await recordBilling(
    "main",
    agentLayers.main.modelId,
    mainGeneration
  )
  if (!subagentRunStarted) {
    await recorder.appendEvent("main.delegation_skipped", {
      completed: mainGeneration.output?.completed ?? false,
    })
    throw new Error(
      "Main agent returned a report without running the required subagent pipeline"
    )
  }

  const uncoveredChangedFiles = getUncoveredChangedFiles()
  if (
    reviewAgentConfig.subagent.requireCompleteFileCoverage &&
    uncoveredChangedFiles.length > 0
  ) {
    await recorder.appendEvent("main.file_coverage_incomplete", {
      uncoveredFiles: uncoveredChangedFiles,
    })
    throw new Error(
      `Main agent returned a report before discovery read every changed file: ${uncoveredChangedFiles.join(", ")}`
    )
  }

  const missingDecisionIds = mainQueue
    .filter((item) => !savedMainDecisions.has(item.id))
    .map((item) => item.id)
  if (missingDecisionIds.length > 0) {
    await recorder.writeJson("main-agent-validation-error.json", {
      missingDecisionIds,
      savedDecisionIds: [...savedMainDecisions.keys()],
      output: mainGeneration.output,
    })
    throw new Error(
      `Main agent stopped before saving all decisions: ${missingDecisionIds.join(", ")}`
    )
  }

  if (!submittedMainReport) {
    await recorder.writeJson("main-agent-validation-error.json", {
      issue: "The main agent did not submit a valid final report.",
      output: mainGeneration.output,
    })
    throw new Error(
      "Main agent stopped before submitting a valid final review report"
    )
  }
  const mainOutput = submittedMainReport
  const finalMainGenerationMetadata = {
    finishReason: mainGeneration.finishReason,
    totalUsage: mainGeneration.totalUsage,
    providerMetadata: mainGeneration.providerMetadata,
  }
  const mainDecisions = [...savedMainDecisions.values()]
  const mainDecisionCounts = mainDecisions.reduce<
    Record<"accept" | "reject", number>
  >(
    (counts, decision) => {
      counts[decision.decision] += 1
      return counts
    },
    { accept: 0, reject: 0 }
  )
  const verifierDecisionsById = new Map(
    findingDecisions
      .filter((decision) => decision.stage === "verifier")
      .map((decision) => [decision.id, decision.decision] as const)
  )
  const verifierMainTransitions: Record<string, number> = {}
  let settledVerifierDecisions = 0
  let settledVerifierAgreements = 0
  for (const decision of mainDecisions) {
    const verifierDecision = verifierDecisionsById.get(decision.id) ?? "missing"
    const transition = `${verifierDecision}->${decision.decision}`
    verifierMainTransitions[transition] =
      (verifierMainTransitions[transition] ?? 0) + 1
    if (verifierDecision === "accept" || verifierDecision === "reject") {
      settledVerifierDecisions += 1
      if (verifierDecision === decision.decision) {
        settledVerifierAgreements += 1
      }
    }
  }
  const verifierMainComparison = {
    settled: settledVerifierDecisions,
    agreed: settledVerifierAgreements,
    disagreed: settledVerifierDecisions - settledVerifierAgreements,
    agreementRate:
      settledVerifierDecisions === 0
        ? null
        : settledVerifierAgreements / settledVerifierDecisions,
    acceptToReject: verifierMainTransitions["accept->reject"] ?? 0,
    rejectToAccept: verifierMainTransitions["reject->accept"] ?? 0,
    transitions: verifierMainTransitions,
  }
  logger.info("Main review decisions completed", {
    ...context,
    queueItems: mainQueue.length,
    finalFindings: mainOutput.findings.length,
    decisions: mainDecisionCounts,
    inspectedFiles: mainInspectedFiles.size,
    verifierMainComparison,
  })
  await recorder.appendEvent("main.decisions.completed", {
    queueItems: mainQueue.length,
    finalFindings: mainOutput.findings.length,
    decisions: mainDecisionCounts,
    inspection: {
      patchReads: mainPatchReads,
      repositoryToolCalls: mainRepositoryToolCalls,
      files: [...mainInspectedFiles],
    },
    verifierMainComparison,
  })

  await recorder.writeJson("main-agent-output.json", {
    finishReason: finalMainGenerationMetadata.finishReason,
    usage: finalMainGenerationMetadata.totalUsage,
    providerMetadata: finalMainGenerationMetadata.providerMetadata,
    output: mainOutput,
  })
  const linterFindings = await runNaturalLanguageLinter()
  const composedReport = await composedReportPromise

  const mainFindings = mainOutput.findings.map((finding) => {
    const { sourceCandidateIds: _sourceCandidateIds, ...publishedFinding } =
      finding
    return { ...publishedFinding, source: "review" as const }
  })
  const bugFindings = sortBySeverity(mainFindings)
  const candidateReport: ReviewReport = {
    summary: composedReport.summary,
    changedFiles: composedReport.changedFiles,
    reviewerAttention: mainOutput.reviewerAttention,
    mergeSafetyScore: mainOutput.mergeSafetyScore,
    mergeSafetyReason: mainOutput.mergeSafetyReason,
    findings: [...bugFindings, ...linterFindings],
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
  const findingLifecycle = [...candidatesById.values()].map((candidate) => {
    const publicationMatches = finalReport.findings
      .map((finding, index) => ({ finding, index }))
      .filter(({ finding }) => resemblesSameIssue(candidate, finding))
      .map(({ finding, index }) => ({
        findingIndex: index,
        source: finding.source ?? "review",
        title: finding.title,
        file: finding.file,
        startLine: finding.startLine,
        endLine: finding.endLine,
      }))
    return {
      id: candidate.id,
      candidate,
      decisions: findingDecisions.filter(
        (decision) => decision.id === candidate.id
      ),
      publication: {
        published: publicationMatches.length > 0,
        matches: publicationMatches,
      },
    }
  })
  await recorder.writeJson("finding-decisions.json", findingDecisions)
  await recorder.writeJson("finding-lifecycle.json", {
    generatedAt: new Date().toISOString(),
    models: {
      discovery: agentLayers.subagent.modelId,
      verifier: agentLayers.verifier.modelId,
      main: agentLayers.main.modelId,
    },
    candidates: findingLifecycle,
    mainFindings: mainOutput.findings,
    finalFindings: finalReport.findings,
  })
  await recorder.writeJson("pipeline-trace.json", {
    generatedAt: new Date().toISOString(),
    configuration: {
      subagentConcurrency: reviewAgentConfig.subagent.concurrency,
      requireCompleteFileCoverage:
        reviewAgentConfig.subagent.requireCompleteFileCoverage,
      verifierConcurrency: reviewAgentConfig.verifier.concurrency,
      subagentMaxSteps: reviewAgentConfig.subagent.maxSteps,
      verifierMaxSteps: reviewAgentConfig.verifier.maxSteps,
      mainMaxSteps: reviewAgentConfig.main.maxSteps,
    },
    mainInspection: {
      patchReads: mainPatchReads,
      repositoryToolCalls: mainRepositoryToolCalls,
      files: [...mainInspectedFiles],
    },
    discovery: {
      calls: subagentCallCount,
      waves: subagentWaveCount,
      coveredFiles: [...subagentCoveredFiles].sort(),
      uncoveredFiles: getUncoveredChangedFiles(),
      candidates: discoveredCandidates,
    },
    decisions: findingDecisions,
    mainOutput,
    evidenceValidation: reportValidation,
    finalReport,
  })
  const renderedReport = renderReviewSummaryComment({
    report: finalReport,
    inlineReview: { kind: "not_needed" },
  })
  await recorder.writeText("rendered-comment.md", renderedReport)
  const generationUsage = { main: [mainUsage], ...usages }
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
    subagentCalls: subagentCallCount,
    subagentWaves: subagentWaveCount,
    subagentConcurrency: reviewAgentConfig.subagent.concurrency,
    rawFindingCount: allCandidateIds.size,
    mainQueueCount: mainQueue.length,
    verifierAcceptedCount,
    decisionCounts,
    verifierMainComparison,
    publishedFindingCount: finalReport.findings.length,
    mainFindings: mainFindings.length,
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
    kind: "analysis" as const,
    summary: renderedReport,
    report: finalReport,
    triggerSource,
    modelId: reviewModels.main,
    subagentModelId: reviewModels.subagent,
    verifierModelId: reviewModels.verifier,
    fetchedFileCount,
    filteredFileCount: filteredFiles.length,
    reviewableAdditions: additions,
    reviewableDeletions: deletions,
    diffChangedLineCount,
    commentId,
    ...generationStats,
    mergeSafetyScore: finalReport.mergeSafetyScore,
    findings: finalReport.findings,
    usage: generationUsage as unknown as Record<string, unknown>,
    billing,
    startedAt: startedAtIso,
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
  }
  await recorder.writeJson("analysis-result.json", result)
  await recorder.writeJson("summary.json", {
    status: "analyzed",
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
    billing,
    counts: recorder.counts(),
    durationMs: result.durationMs,
  })
  logger.info("Review agent stage completed", {
    ...context,
    stage: "analysis",
    commentId,
    durationMs: result.durationMs,
  })
  await recorder.appendEvent("stage.completed", {
    stage: "analysis",
    commentId,
    durationMs: result.durationMs,
  })
  await recorder.appendEvent("review.analyzed", result)
  return result
}

export const publishReviewAnalysis = async ({
  pullRequest,
  reviewRunId,
  repository,
  installationId,
  triggerSource,
  logger,
  analysis,
}: Pick<
  RunInput,
  | "pullRequest"
  | "reviewRunId"
  | "repository"
  | "installationId"
  | "triggerSource"
  | "logger"
> & {
  analysis: ReviewAnalysisResult
}): Promise<ReviewAgentResult> => {
  const context = {
    pullRequestId: pullRequest.id,
    repository: repository.fullName,
    headSha: pullRequest.headSha,
    triggerSource,
  }
  const reviewCommentRunId =
    triggerSource === "mention" ? reviewRunId : undefined
  const recorder = await createReviewRunRecorder({
    reviewRunId,
    repo: repository,
    pullRequest,
    triggerSource,
    modelId: analysis.modelId,
  })
  const finalReport = analysis.report
  const commentId = analysis.commentId
  let publishedReport = analysis.summary ?? "## Review summary"

  logger.info("Review agent stage started", { ...context, stage: "publish" })
  await recorder.appendEvent("stage.started", { stage: "publish" })
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
        inlineReview: { kind: "failed", error: inlineReviewPublishError },
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

  const { report: _report, ...analysisResult } = analysis
  const result: ReviewAgentResult = {
    ...analysisResult,
    kind: "summary",
    summary: publishedReport,
    reviewId,
    reviewEvent,
    inlineCommentCount,
    inlineReviewPublishError,
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - Date.parse(analysis.startedAt),
  }
  await recorder.writeJson("result.json", result)
  await recorder.writeText("published-comment.md", publishedReport)
  await recorder.appendEvent("stage.completed", {
    stage: "publish",
    commentId,
    reviewId,
    reviewEvent,
    inlineCommentCount,
    inlineReviewPublishError,
    durationMs: result.durationMs,
  })
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
