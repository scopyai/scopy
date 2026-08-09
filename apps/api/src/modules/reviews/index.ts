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
  unresolvedQuestion?: string
}

type FindingDecision = {
  id: string
  stage: "verifier" | "main"
  decision: "reject" | "escalate" | "accept" | "failed_open"
  details: unknown
  findingIndex?: number | null
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
      read_file: tool({
        description:
          "Read numbered lines from any repository file. Reads 300 lines by default and up to 800; prefer one large read over paging through a file in small chunks.",
        inputSchema: z.object({
          file: z.string().min(1),
          startLine: z.number().int().positive().optional(),
          maxLines: z.number().int().positive().max(800).optional(),
        }),
        execute: async ({ file, startLine, maxLines }) => {
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
          "Get symbol definitions, signatures, locations, scopes, and source.",
        inputSchema: z.object({ symbol: z.string().min(1) }),
        execute: async ({ symbol }) => {
          onUse?.()
          const result = await getSymbolDefinition({
            repository: runtime.paths.repositoryPath,
            index: runtime.codeIndex,
            symbol,
          })
          for (const definition of result.json.definitions) {
            if (definition.source) onFileRead?.(definition.file)
          }
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
          onUse?.()
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
          onUse?.()
          const result = await searchRepositoryText({
            repository: runtime.paths.repositoryPath,
            index: runtime.codeIndex,
            query,
            maxResults: 50,
          })
          const output = {
            ...result.stats,
            markdown: truncateText(result.markdown),
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
            markdown: truncateText(result.markdown),
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
        }),
        execute: async ({ library, query }) => {
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
                limit: 6,
                maxFragments: 1,
                maxWords: 50,
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
            input: { library, query },
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
  const docsLookupCache = new Map<
    string,
    { found: boolean; answer: string; citations: unknown[] }
  >()
  const createDocsLookupTool = (scope: string): ToolSet => {
    if (availableDocLibraries.length === 0) return {}
    return {
      lookup_docs: tool({
        description: `Answer one focused question about the documented behavior of a library this repository uses (${availableDocLibraries.map((library) => library.name).join(", ")}), with citations. Slow and budgeted per review - ask one specific question about API behavior, defaults, or semantics that decides a verdict.`,
        inputSchema: z.object({
          library: librarySlugEnum(availableDocLibraries),
          question: z.string().min(1).max(500),
        }),
        execute: async ({ library, question }) => {
          const cacheKey = `${library}::${question.trim().toLowerCase()}`
          const cached = docsLookupCache.get(cacheKey)
          if (cached) return cached
          if (docsLookupsUsed >= DOCS_LOOKUP_BUDGET) {
            return {
              found: false,
              answer:
                "Documentation lookup budget for this review is exhausted. Decide from repository evidence.",
              citations: [],
            }
          }
          docsLookupsUsed += 1
          let output: { found: boolean; answer: string; citations: unknown[] }
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
          await recorder.recordToolCall({
            name: `${scope}.lookup_docs`,
            input: { library, question },
            output,
          })
          await recorder.appendEvent("docs.lookup", {
            scope,
            library,
            found: output.found,
            used: docsLookupsUsed,
            budget: DOCS_LOOKUP_BUDGET,
          })
          return output
        },
      }),
    }
  }

  const allCandidateIds = new Set<string>()
  const candidatesById = new Map<string, CandidateFinding>()
  const discoveredCandidates: CandidateFinding[] = []
  const mainQueue: QueueItem[] = []
  const mainQueueIds = new Set<string>()
  let verifierAcceptedCount = 0
  const findingDecisions: FindingDecision[] = []
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

Repository context:
${preparedRepositoryContext.markdown}

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
        const item: QueueItem = {
          ...candidate,
          verifierVerdict: verdict.verdict,
          ...(verdict.verdict === "escalate"
            ? { unresolvedQuestion: verdict.unresolvedQuestion }
            : {}),
        }
        mainQueue.push(item)
        newQueue.push(item)
        mainQueueIds.add(candidate.id)
      }

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
        reviewQueue: newQueue.map(({ taskId: _taskId, ...item }) => item),
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
      "Read the full diff patch for one changed file in this pull request.",
    inputSchema: z.object({ file: z.string().min(1) }),
    execute: async ({ file }) => {
      const entry = patchesByFile.get(file)
      const omitted = omittedByFile.get(file)
      if (entry || omitted) {
        mainPatchReads += 1
        mainInspectedFiles.add(file)
      }
      const output = entry
        ? { file, patch: truncateText(serializePullRequestFiles([entry])) }
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
  const mainResponseSchema = mainReviewReportSchema.extend({
    findings: z.array(mainFindingSchema),
    decisions: z.array(reviewDecisionOutputSchema),
  })
  const mainOutputSchema = mainResponseSchema
    .extend({ decisions: z.array(reviewDecisionSchema) })
    .superRefine((output, validation) => {
      const seen = new Set<string>()
      const problems: string[] = []
      for (const decision of output.decisions) {
        if (!mainQueueIds.has(decision.id))
          problems.push(`unknown ${decision.id}`)
        if (seen.has(decision.id)) problems.push(`duplicate ${decision.id}`)
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
        for (const problem of validateProofLocations({
          proof: decision,
          inspectedFiles: mainInspectedFiles,
          changedLinesByFile: proofLinesByFile,
        })) {
          problems.push(`${decision.id}: ${problem}`)
        }
      }
      for (const id of mainQueueIds) {
        if (!seen.has(id)) problems.push(`missing ${id}`)
      }
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
          const decision = output.decisions.find((item) => item.id === id)
          if (
            !decision ||
            decision.decision !== "accept" ||
            decision.findingIndex !== findingIndex
          ) {
            problems.push(
              `finding ${findingIndex} source ${id} does not map back to it`
            )
          }
        }
      }
      for (const decision of output.decisions) {
        if (
          decision.decision === "accept" &&
          decision.findingIndex !== null &&
          !output.findings[decision.findingIndex]?.sourceCandidateIds.includes(
            decision.id
          )
        ) {
          problems.push(
            `accepted ${decision.id} is missing from finding ${decision.findingIndex} sourceCandidateIds`
          )
        }
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
      ...createDocsLookupTool("main"),
    },
    providerOptions: agentLayers.main.providerOptions,
    output: repairedJsonOutput(
      Output.object({
        schema: mainResponseSchema,
        name: "review_report",
        description:
          "Final review findings and exactly one decision per reviewQueue id",
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
      findings: mainGeneration.output?.findings?.length ?? 0,
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

  const rawMainOutput = mainResponseSchema.parse(mainGeneration.output)
  const returnedIds = new Set(rawMainOutput.decisions.map(({ id }) => id))
  const unknownDecisions = rawMainOutput.decisions.filter(
    ({ id }) => !mainQueueIds.has(id)
  )
  const missingIds = [...mainQueueIds].filter((id) => !returnedIds.has(id))
  const correctedId =
    unknownDecisions.length === 1 && missingIds.length === 1
      ? { from: unknownDecisions[0]!.id, to: missingIds[0]! }
      : null
  const normalizedMainOutput = correctedId
    ? {
        ...rawMainOutput,
        findings: rawMainOutput.findings.map((finding) => ({
          ...finding,
          sourceCandidateIds: finding.sourceCandidateIds.map((id) =>
            id === correctedId.from ? correctedId.to : id
          ),
        })),
        decisions: rawMainOutput.decisions.map((decision) =>
          decision.id === correctedId.from
            ? { ...decision, id: correctedId.to }
            : decision
        ),
      }
    : rawMainOutput
  if (correctedId) {
    await recorder.appendEvent("main.decision_id.corrected", correctedId)
    logger.info("Corrected one unambiguous main decision id", {
      ...context,
      ...correctedId,
    })
  }
  const parsedMainOutput = mainOutputSchema.safeParse(normalizedMainOutput)
  if (!parsedMainOutput.success) {
    await recorder.writeJson("main-agent-validation-error.json", {
      issues: parsedMainOutput.error.issues,
      output: normalizedMainOutput,
    })
    throw new Error(
      `Main report failed contract validation: ${parsedMainOutput.error.issues.map((issue) => issue.message).join("; ")}`
    )
  }
  const mainOutput = parsedMainOutput.data
  const finalMainGenerationMetadata = {
    finishReason: mainGeneration.finishReason,
    totalUsage: mainGeneration.totalUsage,
    providerMetadata: mainGeneration.providerMetadata,
  }
  for (const decision of mainOutput.decisions) {
    findingDecisions.push({
      id: decision.id,
      stage: "main",
      decision: decision.decision,
      details: decision,
      findingIndex:
        decision.decision === "accept" ? decision.findingIndex : undefined,
    })
  }
  const mainDecisionCounts = mainOutput.decisions.reduce<
    Record<"accept" | "reject", number>
  >(
    (counts, decision) => {
      counts[decision.decision] += 1
      return counts
    },
    { accept: 0, reject: 0 }
  )
  logger.info("Main review decisions completed", {
    ...context,
    queueItems: mainQueue.length,
    finalFindings: mainOutput.findings.length,
    decisions: mainDecisionCounts,
    inspectedFiles: mainInspectedFiles.size,
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
    mainQueueCount: mainQueueIds.size,
    verifierAcceptedCount,
    decisionCounts,
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
