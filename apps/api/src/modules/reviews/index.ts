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
import type { pullRequest, repository, reviewConfig } from "../../db/schema"
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
  type PullRequestFile,
} from "./diff"
import {
  findOrCreateReviewComment,
  listPullRequestFiles,
  publishPullRequestReview,
  type PullRequestReviewEvent,
  reviewFailedBody,
  updateReviewComment,
} from "./github"
import {
  filterReportToValidEvidence,
  validateReviewReportEvidence,
  type ReviewReportEvidenceValidation,
} from "./evidence"
import {
  buildFileScoutPrompt,
  buildFileScoutPlan,
  buildReviewEvidenceRepairPrompt,
  buildReviewJudgePrompt,
  buildReviewVerifierPrompt,
  aggregateScoutFindings,
  fileScoutInstructions,
  fileScoutOutputSchema,
  renderAffectedSymbolsForFile,
  renderAffectedSymbols,
  renderReviewSummaryComment,
  renderSemanticCoverage,
  reviewJudgeInstructions,
  reviewJudgeOutputSchema,
  reviewEvidenceRepairInstructions,
  reviewEvidenceRepairSchema,
  reviewVerifierInstructions,
  reviewVerificationSchema,
  type CandidateFinding,
  type FileScoutOutput,
  type ReviewEvidenceRepair,
  type ReviewJudgeOutput,
  type ReviewReport,
  type ReviewVerification,
} from "./prompt"
import { createReviewRunRecorder } from "./debug-run"
import { prepareRepositoryContextForReview } from "./repository-context"
import { prepareReviewRuntime } from "./runtime"

export const REVIEW_MODEL = env.REVIEW_MODEL
export const REVIEW_VERIFIER_MODEL =
  env.REVIEW_VERIFIER_MODEL ?? env.REVIEW_MODEL
const reviewModelProviderOptions = REVIEW_MODEL.startsWith("openai/")
  ? {
      openrouter: {
        reasoning: {
          effort: "low",
        },
      },
    }
  : undefined
const verifierModelProviderOptions = REVIEW_VERIFIER_MODEL.startsWith("openai/")
  ? {
      openrouter: {
        reasoning: {
          effort: "low",
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
  reviewConfig: typeof reviewConfig.$inferSelect | null
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

const applyVerification = (
  report: ReviewReport,
  candidates: CandidateFinding[],
  verification: ReviewVerification | null
): ReviewReport => {
  if (!verification) return report
  const confirmed = new Set(
    verification.verifications
      .filter((item) => item.confirmed)
      .map((item) => item.candidateId)
  )
  const findings = candidates.filter((finding) =>
    confirmed.has(finding.candidateId)
  )

  return {
    summary: report.summary,
    mergeSafetyScore: report.mergeSafetyScore,
    mergeSafetyReason: report.mergeSafetyReason,
    findings,
  }
}

const serializeJsonl = (records: unknown[]) =>
  records.map((record) => JSON.stringify(record)).join("\n")

const reportFromJudgeOutput = (output: ReviewJudgeOutput): ReviewReport => ({
  summary: output.summary,
  mergeSafetyScore: output.mergeSafetyScore,
  mergeSafetyReason: output.mergeSafetyReason,
  findings: output.findings,
})

const validateJudgeDecisionLedger = (
  output: ReviewJudgeOutput,
  scoutFindings: { candidateId: string }[]
) => {
  const expected = new Set(scoutFindings.map((finding) => finding.candidateId))
  const seen = new Set<string>()
  const duplicateDecisionIds = new Set<string>()
  const unknownDecisionIds = new Set<string>()

  for (const decision of output.decisions) {
    if (seen.has(decision.candidateId)) {
      duplicateDecisionIds.add(decision.candidateId)
    }
    seen.add(decision.candidateId)
    if (!expected.has(decision.candidateId)) {
      unknownDecisionIds.add(decision.candidateId)
    }
  }

  return {
    expected: expected.size,
    actual: output.decisions.length,
    missingDecisionIds: [...expected].filter(
      (candidateId) => !seen.has(candidateId)
    ),
    unknownDecisionIds: [...unknownDecisionIds],
    duplicateDecisionIds: [...duplicateDecisionIds],
  }
}

const buildEvidenceRepairFileContexts = ({
  invalidFindings,
  files,
}: {
  invalidFindings: ReviewReportEvidenceValidation["findings"]
  files: PullRequestFile[]
}) => {
  const filesByName = new Map(files.map((file) => [file.filename, file]))
  const neededFiles = [...new Set(invalidFindings.map((finding) => finding.file))]

  return neededFiles.map((file) => {
    const pullRequestFile = filesByName.get(file)
    return {
      file,
      status: pullRequestFile?.status ?? "unknown",
      patch: pullRequestFile?.patch ?? null,
      patchAvailable: Boolean(pullRequestFile?.patch),
      invalidFindings: invalidFindings
        .filter((finding) => finding.file === file)
        .map((finding) => ({
          findingIndex: finding.findingIndex,
          title: finding.title,
          startLine: finding.startLine,
          endLine: finding.endLine,
          reasons: finding.reasons,
          selectedSource: finding.selectedSource,
          changedLineOverlap: finding.changedLineOverlap,
        })),
    }
  })
}

const applyEvidenceRepairs = (
  report: ReviewReport,
  repair: ReviewEvidenceRepair
): ReviewReport => {
  const replacements = new Map(
    repair.repairs
      .filter((item) => item.action === "replace" && item.finding)
      .map((item) => [item.findingIndex, item.finding!])
  )
  const drops = new Set(
    repair.repairs
      .filter((item) => item.action === "drop")
      .map((item) => item.findingIndex)
  )

  return {
    ...report,
    findings: report.findings.flatMap((finding, index) => {
      if (drops.has(index)) return []
      return [replacements.get(index) ?? finding]
    }),
  }
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
    reviewConfig?.pathIncludePatterns ?? [],
    reviewConfig?.pathExcludePatterns ?? []
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
    contextModel: openrouter.chat(REVIEW_MODEL),
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
  const judgeInspectedSymbols = new Set<string>()
  const createScoutTools = (sourceFile: string, localToolCalls: unknown[]) => ({
    get_symbol_definition: tool({
      description:
        "Given only a symbol name, returns matching definitions with signature, parameters, return type, file/line range, enclosing scope metadata, and definition source.",
      inputSchema: z.object({
        symbol: z.string().min(1),
      }),
      execute: async ({ symbol }) => {
        const input = { sourceFile, symbol }
        const result = await getSymbolDefinition({
          repository: runtime.paths.repositoryPath,
          index: runtime.codeIndex,
          symbol,
        })
        const output = { ...result.json, stats: result.stats }
        localToolCalls.push({
          at: new Date().toISOString(),
          name: "get_symbol_definition",
          input,
          output,
        })
        await recorder.recordToolCall({
          name: "file_scout.get_symbol_definition",
          input,
          output,
        })
        return output
      },
    }),
    get_symbol_callers: tool({
      description:
        "Given only a symbol name, returns direct call locations with call lines and enclosing caller symbol metadata.",
      inputSchema: z.object({
        symbol: z.string().min(1),
      }),
      execute: async ({ symbol }) => {
        const input = { sourceFile, symbol }
        const result = await getSymbolCallers({
          repository: runtime.paths.repositoryPath,
          index: runtime.codeIndex,
          symbol,
        })
        const output = { ...result.json, stats: result.stats }
        localToolCalls.push({
          at: new Date().toISOString(),
          name: "get_symbol_callers",
          input,
          output,
        })
        await recorder.recordToolCall({
          name: "file_scout.get_symbol_callers",
          input,
          output,
        })
        return output
      },
    }),
  })
  const baseTools = {
    read_file: tool({
      description:
        "Expensive fallback. Returns numbered lines from a repository file by repo-relative path. Use only for a small explicit range when symbol tools, semantic search, and locate_text do not provide enough context, or when AST coverage is unavailable. Defaults to 80 lines and returns at most 200 lines.",
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
        await recorder.recordToolCall({ name: "read_file", input, output })
        return output
      },
    }),
    get_symbol_definition: tool({
      description:
        "Preferred code-inspection tool. Given only a symbol name, returns matching definitions with signature, parameters, return type, file/line range, enclosing scope metadata, and definition source.",
      inputSchema: z.object({
        symbol: z.string().min(1),
      }),
      execute: async ({ symbol }) => {
        const input = { symbol }
        judgeInspectedSymbols.add(symbol)
        const result = await getSymbolDefinition({
          repository: runtime.paths.repositoryPath,
          index: runtime.codeIndex,
          symbol,
        })
        const output = { ...result.json, stats: result.stats }
        await recorder.recordToolCall({
          name: "get_symbol_definition",
          input,
          output,
        })
        return output
      },
    }),
    get_symbol_callers: tool({
      description:
        "Preferred call-graph tool. Given only a symbol name, returns direct call locations with call lines and enclosing caller symbol metadata.",
      inputSchema: z.object({
        symbol: z.string().min(1),
      }),
      execute: async ({ symbol }) => {
        const input = { symbol }
        judgeInspectedSymbols.add(symbol)
        const result = await getSymbolCallers({
          repository: runtime.paths.repositoryPath,
          index: runtime.codeIndex,
          symbol,
        })
        const output = { ...result.json, stats: result.stats }
        await recorder.recordToolCall({
          name: "get_symbol_callers",
          input,
          output,
        })
        return output
      },
    }),
    locate_text: tool({
      description:
        "Niche literal locator, not a code-reading tool. Use only to find where an exact identifier, route path, config key, env var, table/column name, import, filename, or error string appears when symbol tools are not enough. Returns file/line/column and enclosing symbol metadata only; call symbol tools next for code context.",
      inputSchema: z.object({
        query: z.string().min(1),
      }),
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
        await recorder.recordToolCall({ name: "locate_text", input, output })
        return output
      },
    }),
  }
  const tools = semanticEnabled
    ? {
        ...baseTools,
        search_code: tool({
          description:
            "Semantic code search. Use this for behavior/concept searches when exact identifiers are unknown, such as finding related implementations, similar logic, or broader context. Do not use it for exact strings, route paths, env names, table columns, or symbol names when literal matching is needed.",
          inputSchema: z.object({
            query: z.string().min(1),
            limit: z.number().int().positive().max(20).optional(),
          }),
          execute: async ({ query, limit = 10 }) => {
            const input = { query, limit }
            if (!runtime.qdrant) {
              const output = {
                chunks: 0,
                markdown:
                  "Semantic code search is unavailable because Qdrant is not configured.",
              }
              await recorder.recordToolCall({
                name: "search_code",
                input,
                output,
              })
              return output
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
              name: "search_code",
              input,
              output,
            })
            return output
          },
        }),
      }
    : baseTools
  const createJudgeAgent = () =>
    new ToolLoopAgent({
      model: openrouter.chat(REVIEW_MODEL),
      instructions: reviewJudgeInstructions,
      tools,
      providerOptions: reviewModelProviderOptions,
      output: Output.object({
        schema: reviewJudgeOutputSchema,
        name: "review_judge_output",
        description:
          "Structured pull request review report with scout candidate decisions",
      }),
      maxRetries: 2,
      onStepFinish: async (step) => {
        await recorder.recordStep(step)
      },
    })
  const createEvidenceRepairAgent = () =>
    new ToolLoopAgent({
      model: openrouter.chat(REVIEW_MODEL),
      instructions: reviewEvidenceRepairInstructions,
      tools: {},
      providerOptions: reviewModelProviderOptions,
      output: Output.object({
        schema: reviewEvidenceRepairSchema,
        name: "review_evidence_repair",
        description: "Repairs invalid review finding evidence ranges",
      }),
      maxRetries: 2,
      onStepFinish: async (step) => {
        await recorder.recordStep(step)
      },
    })
  await recorder.writeText(
    "context/judge-instructions.txt",
    reviewJudgeInstructions
  )
  await recorder.writeText(
    "context/file-scout-instructions.txt",
    fileScoutInstructions
  )
  await recorder.writeText(
    "context/evidence-repair-instructions.txt",
    reviewEvidenceRepairInstructions
  )
  const scoutOutputs: FileScoutOutput[] = []
  const fileScoutUsages: unknown[] = []
  const skippedScouts: { file: string; reason: string }[] = []
  const scoutPlan = buildFileScoutPlan(filteredFiles)
  logger.info("Review agent stage started", {
    ...context,
    stage: "fileScout",
    files: scoutPlan.length,
  })
  await recorder.appendEvent("stage.started", {
    stage: "fileScout",
    files: scoutPlan.length,
  })
  for (const item of scoutPlan) {
    if (item.skipped) {
      skippedScouts.push({ file: item.file, reason: item.skipped.reason })
      await recorder.writeJson(`file-scouts/${item.safeFile}/skipped.json`, {
        file: item.file,
        reason: item.skipped.reason,
      })
      continue
    }
    const localToolCalls: unknown[] = []
    const scoutPrompt = buildFileScoutPrompt({
      title: pullRequest.title,
      body: pullRequest.body,
      baseRef: pullRequest.baseRef,
      headRef: pullRequest.headRef,
      file: item.file,
      status: item.status,
      patch: item.patch,
      affectedSymbols: renderAffectedSymbolsForFile(diffContext, item.file),
    })
    await recorder.writeText(
      `file-scouts/${item.safeFile}/prompt.txt`,
      scoutPrompt
    )
    await recorder.writeJson(`file-scouts/${item.safeFile}/prompt-stats.json`, {
      promptBytes: textBytes(scoutPrompt),
      patchBytes: textBytes(item.patch),
    })
    const scoutStartToolCalls = recorder.counts().toolCalls
    const scoutAgent = new ToolLoopAgent({
      model: openrouter.chat(REVIEW_VERIFIER_MODEL),
      instructions: fileScoutInstructions,
      tools: createScoutTools(item.file, localToolCalls),
      providerOptions: verifierModelProviderOptions,
      output: Output.object({
        schema: fileScoutOutputSchema,
        name: "file_security_scout",
        description: "Noisy security candidates for one changed file",
      }),
      maxRetries: 2,
      onStepFinish: async (step) => {
        await recorder.recordStep(step)
      },
    })
    const scoutGeneration = await scoutAgent.generate({ prompt: scoutPrompt })
    fileScoutUsages.push(scoutGeneration.totalUsage)
    await recordLlmBilling(
      llmBilling,
      "fileScout",
      REVIEW_VERIFIER_MODEL,
      scoutGeneration
    )
    const scoutOutput = fileScoutOutputSchema.parse(scoutGeneration.output)
    scoutOutputs.push(scoutOutput)
    await recorder.writeJson(`file-scouts/${item.safeFile}/output.json`, {
      finishReason: scoutGeneration.finishReason,
      usage: scoutGeneration.totalUsage,
      providerMetadata: scoutGeneration.providerMetadata,
      output: scoutGeneration.output,
      text: scoutGeneration.text,
    })
    await recorder.writeText(
      `file-scouts/${item.safeFile}/tool-calls.jsonl`,
      `${serializeJsonl(localToolCalls)}${localToolCalls.length > 0 ? "\n" : ""}`
    )
    await recorder.appendEvent("file_scout.completed", {
      file: item.file,
      findings: scoutOutput.candidates.length,
      inspectedSymbols: scoutOutput.inspectedSymbols,
      toolCalls: recorder.counts().toolCalls - scoutStartToolCalls,
    })
  }
  const scoutFindings = aggregateScoutFindings(scoutOutputs)
  await recorder.writeJson("candidate-scout-findings.json", scoutFindings)
  await recorder.writeJson("file-scouts/summary.json", {
    files: filteredFiles.length,
    completed: scoutOutputs.length,
    skipped: skippedScouts,
    candidateFindings: scoutFindings.length,
    perFile: scoutOutputs.map((output) => ({
      file: output.file,
      candidates: output.candidates.length,
      inspectedSymbols: output.inspectedSymbols,
      notes: output.notes,
    })),
  })
  logger.info("Review agent stage completed", {
    ...context,
    stage: "fileScout",
    completed: scoutOutputs.length,
    skipped: skippedScouts.length,
    candidateFindings: scoutFindings.length,
  })
  await recorder.appendEvent("stage.completed", {
    stage: "fileScout",
    completed: scoutOutputs.length,
    skipped: skippedScouts.length,
    candidateFindings: scoutFindings.length,
  })
  const judgePrompt = buildReviewJudgePrompt({
    title: pullRequest.title,
    body: pullRequest.body,
    baseRef: pullRequest.baseRef,
    headRef: pullRequest.headRef,
    diff,
    affectedSymbols,
    repositoryContext: preparedRepositoryContext.markdown,
    scoutFindings,
  })
  await recorder.writeText("context/judge-prompt.txt", judgePrompt)
  await recorder.writeJson("context/judge-prompt-stats.json", {
    diffBytes: textBytes(diff),
    affectedSymbolsBytes: textBytes(affectedSymbols),
    repositoryContextBytes: textBytes(preparedRepositoryContext.markdown),
    repositoryContextSource: preparedRepositoryContext.source,
    repositoryContextId: preparedRepositoryContext.contextId,
    repositoryContextBaseSha: preparedRepositoryContext.baseSha,
    scoutCandidateFindings: scoutFindings.length,
    promptBytes: textBytes(judgePrompt),
    semanticEnabled,
    semanticContextPreloaded: false,
  })
  logger.info("Review agent stage started", {
    ...context,
    stage: "judge",
    scoutCandidateFindings: scoutFindings.length,
  })
  await recorder.appendEvent("stage.started", {
    stage: "judge",
    scoutCandidateFindings: scoutFindings.length,
  })
  const judgeGeneration = await createJudgeAgent().generate({
    prompt: judgePrompt,
  })
  const judgeUsage = await recordLlmBilling(
    llmBilling,
    "judge",
    REVIEW_MODEL,
    judgeGeneration
  )
  const judgeOutput = reviewJudgeOutputSchema.parse(judgeGeneration.output)
  const judgeDecisionLedger = validateJudgeDecisionLedger(
    judgeOutput,
    scoutFindings
  )
  const initialReport = reportFromJudgeOutput(judgeOutput)
  await recorder.writeJson("agent-judge-output.json", {
    finishReason: judgeGeneration.finishReason,
    usage: judgeGeneration.totalUsage,
    providerMetadata: judgeGeneration.providerMetadata,
    output: judgeGeneration.output,
    text: judgeGeneration.text,
  })
  await recorder.writeJson("judge-decisions.json", judgeOutput.decisions)
  await recorder.writeJson(
    "judge-decision-ledger-validation.json",
    judgeDecisionLedger
  )
  logger.info("Review agent stage completed", {
    ...context,
    stage: "judge",
    usage: judgeGeneration.totalUsage,
    findings: initialReport.findings.length,
    decisions: judgeOutput.decisions.length,
    missingDecisions: judgeDecisionLedger.missingDecisionIds.length,
    unknownDecisions: judgeDecisionLedger.unknownDecisionIds.length,
    duplicateDecisions: judgeDecisionLedger.duplicateDecisionIds.length,
    inspectedSymbols: [...judgeInspectedSymbols].sort(),
  })
  await recorder.appendEvent("stage.completed", {
    stage: "judge",
    usage: judgeGeneration.totalUsage,
    findings: initialReport.findings.length,
    decisions: judgeOutput.decisions.length,
    missingDecisions: judgeDecisionLedger.missingDecisionIds.length,
    unknownDecisions: judgeDecisionLedger.unknownDecisionIds.length,
    duplicateDecisions: judgeDecisionLedger.duplicateDecisionIds.length,
    inspectedSymbols: [...judgeInspectedSymbols].sort(),
  })
  await recorder.writeJson("candidate-review-report.json", initialReport)
  let report = initialReport
  let reportValidation: ReviewReportEvidenceValidation =
    await validateReviewReportEvidence({
      repository: runtime.paths.repositoryPath,
      diffFiles: parsedDiffFiles,
      report,
    })
  await recorder.writeJson(
    "candidate-review-report-validation.json",
    reportValidation
  )
  let repairUsage: unknown
  if (!reportValidation.valid) {
    logger.info("Review agent stage started", {
      ...context,
      stage: "evidence-repair",
      invalidFindings: reportValidation.findings.filter(
        (finding) => !finding.valid
      ).length,
    })
    await recorder.appendEvent("stage.started", {
      stage: "evidence-repair",
      invalidFindings: reportValidation.findings.filter(
        (finding) => !finding.valid
      ).length,
    })
    const invalidValidationFindings = reportValidation.findings.filter(
      (finding) => !finding.valid
    )
    const invalidFindings = invalidValidationFindings.map((validation) => ({
      findingIndex: validation.findingIndex,
      finding: report.findings[validation.findingIndex],
      validation,
    }))
    const repairFileContexts = buildEvidenceRepairFileContexts({
      invalidFindings: invalidValidationFindings,
      files: filteredFiles,
    })
    const repairPrompt = buildReviewEvidenceRepairPrompt({
      invalidFindings,
      fileContexts: repairFileContexts,
    })
    await recorder.writeText("context/repair-prompt.txt", repairPrompt)
    await recorder.writeJson("context/repair-prompt-stats.json", {
      promptBytes: textBytes(repairPrompt),
      invalidFindings: invalidValidationFindings.length,
      files: repairFileContexts.length,
      fileContextBytes: textBytes(JSON.stringify(repairFileContexts)),
    })
    await recorder.writeJson("evidence-repair-input.json", {
      invalidFindings,
      fileContexts: repairFileContexts,
    })
    const repairGeneration = await createEvidenceRepairAgent().generate({
      prompt: repairPrompt,
    })
    repairUsage = await recordLlmBilling(
      llmBilling,
      "repair",
      REVIEW_MODEL,
      repairGeneration
    )
    const repairOutput = reviewEvidenceRepairSchema.parse(repairGeneration.output)
    report = applyEvidenceRepairs(report, repairOutput)
    await recorder.writeJson("agent-repair-output.json", {
      finishReason: repairGeneration.finishReason,
      usage: repairGeneration.totalUsage,
      providerMetadata: repairGeneration.providerMetadata,
      output: repairGeneration.output,
      text: repairGeneration.text,
    })
    await recorder.writeJson("evidence-repairs.json", repairOutput)
    await recorder.writeJson("repaired-candidate-review-report.json", report)
    reportValidation = await validateReviewReportEvidence({
      repository: runtime.paths.repositoryPath,
      diffFiles: parsedDiffFiles,
      report,
    })
    await recorder.writeJson(
      "repaired-candidate-review-report-validation.json",
      reportValidation
    )
    logger.info("Review agent stage completed", {
      ...context,
      stage: "evidence-repair",
      usage: repairGeneration.totalUsage,
      findings: report.findings.length,
      invalidFindings: reportValidation.findings.filter(
        (finding) => !finding.valid
      ).length,
    })
    await recorder.appendEvent("stage.completed", {
      stage: "evidence-repair",
      usage: repairGeneration.totalUsage,
      findings: report.findings.length,
      invalidFindings: reportValidation.findings.filter(
        (finding) => !finding.valid
      ).length,
    })
  }
  const invalidEvidenceFindings = report.findings.filter(
    (_, index) => !reportValidation.findings[index]?.valid
  )
  report = filterReportToValidEvidence(report, reportValidation)
  await recorder.writeJson(
    "evidence-filtered-findings.json",
    invalidEvidenceFindings
  )
  await recorder.writeJson("evidence-validated-review-report.json", report)
  const candidateFindings: CandidateFinding[] = report.findings.map(
    (finding, index) => ({
      candidateId: `finding-${index}`,
      ...finding,
    })
  )
  await recorder.writeJson("candidate-findings.json", candidateFindings)
  let verification: ReviewVerification | null = null
  let verificationUsage: unknown
  if (candidateFindings.length > 0) {
    logger.info("Review agent stage started", {
      ...context,
      stage: "verification",
      findings: candidateFindings.length,
      verifierModelId: REVIEW_VERIFIER_MODEL,
    })
    await recorder.appendEvent("stage.started", {
      stage: "verification",
      findings: candidateFindings.length,
    })
    const verifierAgent = new ToolLoopAgent({
      model: openrouter.chat(REVIEW_VERIFIER_MODEL),
      instructions: reviewVerifierInstructions,
      tools,
      providerOptions: verifierModelProviderOptions,
      output: Output.object({
        schema: reviewVerificationSchema,
        name: "review_verification",
        description: "Verification decisions for candidate review findings",
      }),
      maxRetries: 2,
      onStepFinish: async (step) => {
        await recorder.recordStep(step)
      },
    })
    const verificationPrompt = buildReviewVerifierPrompt({
      title: pullRequest.title,
      body: pullRequest.body,
      baseRef: pullRequest.baseRef,
      headRef: pullRequest.headRef,
      diff,
      affectedSymbols,
      repositoryContext: preparedRepositoryContext.markdown,
      candidates: candidateFindings,
    })
    await recorder.writeText(
      "context/verification-instructions.txt",
      reviewVerifierInstructions
    )
    await recorder.writeText(
      "context/verification-prompt.txt",
      verificationPrompt
    )
    await recorder.writeJson("context/verification-prompt-stats.json", {
      promptBytes: textBytes(verificationPrompt),
      repositoryContextBytes: textBytes(preparedRepositoryContext.markdown),
      repositoryContextId: preparedRepositoryContext.contextId,
      semanticCoverageBytes: 0,
      semanticEnabled,
      findings: candidateFindings.length,
    })
    const verificationGeneration = await verifierAgent.generate({
      prompt: verificationPrompt,
    })
    verification = reviewVerificationSchema.parse(verificationGeneration.output)
    verificationUsage = await recordLlmBilling(
      llmBilling,
      "verification",
      REVIEW_VERIFIER_MODEL,
      verificationGeneration
    )
    await recorder.writeJson("verification-output.json", {
      finishReason: verificationGeneration.finishReason,
      modelId: REVIEW_VERIFIER_MODEL,
      usage: verificationGeneration.totalUsage,
      providerMetadata: verificationGeneration.providerMetadata,
      output: verificationGeneration.output,
      text: verificationGeneration.text,
    })
    await recorder.writeJson("verification-report.json", verification)
    logger.info("Review agent stage completed", {
      ...context,
      stage: "verification",
      verifierModelId: REVIEW_VERIFIER_MODEL,
      usage: verificationGeneration.totalUsage,
      confirmedFindings: verification.verifications.filter(
        (item) => item.confirmed
      ).length,
    })
    await recorder.appendEvent("stage.completed", {
      stage: "verification",
      verifierModelId: REVIEW_VERIFIER_MODEL,
      usage: verificationGeneration.totalUsage,
      confirmedFindings: verification.verifications.filter(
        (item) => item.confirmed
      ).length,
    })
  }
  const rejectedFindings = verification
    ? candidateFindings.filter(
        (candidate) =>
          !verification.verifications.some(
            (item) =>
              item.candidateId === candidate.candidateId && item.confirmed
          )
      )
    : []
  const finalReport = applyVerification(report, candidateFindings, verification)
  const renderedReport = renderReviewSummaryComment({
    report: finalReport,
    files: filteredFiles,
    inlineReview: { kind: "not_needed" },
  })
  await recorder.writeJson("review-report.json", finalReport)
  await recorder.writeJson("rejected-findings.json", rejectedFindings)
  await recorder.writeText("rendered-comment.md", renderedReport)
  logger.info("Review agent stage completed", {
    ...context,
    stage: "generation",
    usage: {
      fileScout: fileScoutUsages,
      judge: judgeUsage,
      repair: repairUsage,
      verification: verificationUsage,
    },
    mergeSafetyScore: finalReport.mergeSafetyScore,
    findings: finalReport.findings.length,
    candidateFindings: report.findings.length,
    generatedCandidateFindings: initialReport.findings.length,
    evidenceFilteredFindings: invalidEvidenceFindings.length,
  })
  await recorder.appendEvent("stage.completed", {
    stage: "generation",
    usage: {
      fileScout: fileScoutUsages,
      judge: judgeUsage,
      repair: repairUsage,
      verification: verificationUsage,
    },
    mergeSafetyScore: finalReport.mergeSafetyScore,
    findings: finalReport.findings.length,
    candidateFindings: report.findings.length,
    generatedCandidateFindings: initialReport.findings.length,
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
        files: filteredFiles,
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
      publishedReport = renderReviewSummaryComment({
        report: finalReport,
        files: filteredFiles,
        inlineReview: {
          kind: "published",
          inlineCommentCount: inlineReview.inlineCommentCount,
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
      } catch (summaryError) {
        logger.error("Failed to update summary after inline review publish", {
          ...context,
          stage: "publish",
          commentId,
          reviewId,
          reviewEvent,
          inlineCommentCount,
          error: summaryError,
        })
      }
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
    usage: {
      fileScout: fileScoutUsages,
      judge: judgeUsage,
      repair: repairUsage,
      verification: verificationUsage,
    } as unknown as Record<string, unknown>,
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
    candidateFindings: report.findings.length,
    generatedCandidateFindings: initialReport.findings.length,
    evidenceFilteredFindings: invalidEvidenceFindings.length,
    confirmedFindings: finalReport.findings.length,
    inlineCommentCount,
    reviewId,
    reviewEvent,
    inlineReviewPublishError,
    rejectedFindings: rejectedFindings.length,
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
