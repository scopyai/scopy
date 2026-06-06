import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import { Output, ToolLoopAgent, tool } from "ai"
import {
  buildDiffContext,
  getSymbolCallers,
  getSymbolDefinition,
  indexReviewCodebase,
  readRepositoryFile,
  searchReviewCode,
  parseUnifiedDiff,
} from "tools"
import { z } from "zod"
import { env } from "../../env"
import type { pullRequest, repository, reviewConfig } from "../../db/schema"
import {
  filterPullRequestFiles,
  getDiffSkipReason,
  serializePullRequestFilesAsUnifiedDiff,
  serializePullRequestFiles,
} from "./diff"
import {
  findOrCreateReviewComment,
  listPullRequestFiles,
  reviewFailedBody,
  updateReviewComment,
} from "./github"
import {
  buildReviewAgentPrompt,
  buildReviewVerifierPrompt,
  renderAffectedSymbols,
  renderReviewReport,
  reviewReportSchema,
  reviewVerificationSchema,
  type ReviewReport,
  type ReviewVerification,
} from "./prompt"
import { createReviewRunRecorder } from "./debug-run"
import { prepareReviewRuntime } from "./runtime"

export const REVIEW_MODEL = env.REVIEW_MODEL
export const REVIEW_VERIFIER_MODEL =
  env.REVIEW_VERIFIER_MODEL ?? env.REVIEW_MODEL

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
  fetchedFileCount: number
  filteredFileCount: number
  diffCharacterCount: number
  commentId: number
  skipReason?: string
  mergeSafetyScore?: number
  usage?: Record<string, unknown>
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

const applyVerification = (
  report: ReviewReport,
  verification: ReviewVerification | null,
): ReviewReport => {
  if (!verification) return report
  const confirmed = new Set(
    verification.verifications
      .filter((item) => item.confirmed)
      .map((item) => item.findingIndex),
  )
  const findings = report.findings.filter((_, index) => confirmed.has(index))
  if (findings.length === 0) {
    return {
      summary: "No candidate findings were confirmed by verification.",
      mergeSafetyScore: 5,
      mergeSafetyReason:
        "The verifier did not confirm any actionable issue in the candidate report.",
      findings,
    }
  }
  return {
    summary: verification.summary,
    mergeSafetyScore: verification.mergeSafetyScore,
    mergeSafetyReason: verification.mergeSafetyReason,
    findings,
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
  const runtime = await prepareReviewRuntime({
    reviewRunId,
    repo: repository,
    pullRequest,
    installationId,
    changedFiles: filteredFiles.map((file) => file.filename),
  })
  const diffContext = await buildDiffContext({
    repository: runtime.paths.repositoryPath,
    diffFiles: parseUnifiedDiff(unifiedDiff),
  })
  const affectedSymbols = renderAffectedSymbols(diffContext)
  await recorder.writeJson("runtime.json", {
    paths: runtime.paths,
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
  let qdrantChunks = 0
  let qdrantIndexedFiles = 0
  let qdrantIgnoredFiles = 0
  if (runtime.qdrant) {
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
  }
  logger.info("Review agent stage completed", {
    ...context,
    stage: "runtime",
    repositoryPath: runtime.paths.repositoryPath,
    diagnostics: runtime.codeIndex.diagnostics.length,
    qdrantEnabled: Boolean(runtime.qdrant),
    qdrantChunks,
    qdrantIndexedFiles,
    qdrantIgnoredFiles,
  })
  await recorder.appendEvent("stage.completed", {
    stage: "runtime",
    repositoryPath: runtime.paths.repositoryPath,
    diagnostics: runtime.codeIndex.diagnostics.length,
    qdrantEnabled: Boolean(runtime.qdrant),
    qdrantChunks,
    qdrantIndexedFiles,
    qdrantIgnoredFiles,
  })

  logger.info("Review agent stage started", { ...context, stage: "generation" })
  await recorder.appendEvent("stage.started", { stage: "generation" })
  const openrouter = createOpenRouter({ apiKey: requireOpenRouterApiKey() })
  const tools = {
    read_file: tool({
      description:
        "Returns numbered lines from a repository file by repo-relative path. Defaults to 80 lines and returns at most 200 lines.",
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
        "Returns repository definitions for a symbol name, including file and line ranges.",
      inputSchema: z.object({
        symbol: z.string().min(1),
        includeSource: z.boolean().optional(),
        includeParentSource: z.boolean().optional(),
      }),
      execute: async ({
        symbol,
        includeSource = false,
        includeParentSource = false,
      }) => {
        const input = { symbol, includeSource, includeParentSource }
        const result = await getSymbolDefinition({
          repository: runtime.paths.repositoryPath,
          index: runtime.codeIndex,
          symbol,
          includeSource,
          includeParentSource,
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
        "Returns direct call sites for a symbol name, with call lines and enclosing symbol locations.",
      inputSchema: z.object({
        symbol: z.string().min(1),
        includeCallerDefinitions: z.boolean().optional(),
        includeUnresolved: z.boolean().optional(),
        maxCallers: z.number().int().positive().max(100).optional(),
      }),
      execute: async ({
        symbol,
        includeCallerDefinitions = false,
        includeUnresolved = true,
        maxCallers = 50,
      }) => {
        const input = {
          symbol,
          includeCallerDefinitions,
          includeUnresolved,
          maxCallers,
        }
        const result = await getSymbolCallers({
          repository: runtime.paths.repositoryPath,
          index: runtime.codeIndex,
          symbol,
          includeCallerDefinitions,
          includeUnresolved,
          maxCallers,
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
    search_code: tool({
      description:
        "Search the indexed repository code for chunks semantically related to a natural language query.",
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
          await recorder.recordToolCall({ name: "search_code", input, output })
          return output
        }
        const result = await searchReviewCode({
          repositoryId: repository.id,
          headSha: pullRequest.headSha,
          reviewRunId,
          qdrant: runtime.qdrant,
          query,
          limit,
        })
        const output = {
          ...result.stats,
          markdown: toolText(result.markdown),
        }
        await recorder.recordToolCall({ name: "search_code", input, output })
        return output
      },
    }),
  }
  const reviewAgent = new ToolLoopAgent({
    model: openrouter.chat(REVIEW_MODEL),
    tools,
    output: Output.object({
      schema: reviewReportSchema,
      name: "review_report",
      description: "Structured pull request review report",
    }),
    maxRetries: 2,
    onStepFinish: async (step) => {
      await recorder.recordStep(step)
    },
  })
  const prompt = buildReviewAgentPrompt({
    title: pullRequest.title,
    body: pullRequest.body,
    baseRef: pullRequest.baseRef,
    headRef: pullRequest.headRef,
    diff,
    affectedSymbols,
  })
  await recorder.writeText("context/prompt.txt", prompt)
  await recorder.writeJson("context/prompt-stats.json", {
    diffBytes: textBytes(diff),
    affectedSymbolsBytes: textBytes(affectedSymbols),
    promptBytes: textBytes(prompt),
    semanticContextPreloaded: false,
  })
  const generation = await reviewAgent.generate({
    prompt,
  })
  const report = reviewReportSchema.parse(generation.output)
  await recorder.writeJson("agent-output.json", {
    finishReason: generation.finishReason,
    usage: generation.totalUsage,
    output: generation.output,
    text: generation.text,
  })
  await recorder.writeJson("candidate-review-report.json", report)
  let verification: ReviewVerification | null = null
  let verificationUsage: unknown
  if (report.findings.length > 0) {
    logger.info("Review agent stage started", {
      ...context,
      stage: "verification",
      findings: report.findings.length,
      verifierModelId: REVIEW_VERIFIER_MODEL,
    })
    await recorder.appendEvent("stage.started", {
      stage: "verification",
      findings: report.findings.length,
    })
    const verifierAgent = new ToolLoopAgent({
      model: openrouter.chat(REVIEW_VERIFIER_MODEL),
      tools,
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
      report,
    })
    await recorder.writeText("context/verification-prompt.txt", verificationPrompt)
    await recorder.writeJson("context/verification-prompt-stats.json", {
      promptBytes: textBytes(verificationPrompt),
      findings: report.findings.length,
    })
    const verificationGeneration = await verifierAgent.generate({
      prompt: verificationPrompt,
    })
    verification = reviewVerificationSchema.parse(verificationGeneration.output)
    verificationUsage = verificationGeneration.totalUsage
    await recorder.writeJson("verification-output.json", {
      finishReason: verificationGeneration.finishReason,
      modelId: REVIEW_VERIFIER_MODEL,
      usage: verificationGeneration.totalUsage,
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
        (item) => item.confirmed,
      ).length,
    })
    await recorder.appendEvent("stage.completed", {
      stage: "verification",
      verifierModelId: REVIEW_VERIFIER_MODEL,
      usage: verificationGeneration.totalUsage,
      confirmedFindings: verification.verifications.filter(
        (item) => item.confirmed,
      ).length,
    })
  }
  const finalReport = applyVerification(report, verification)
  const rejectedFindings = verification
    ? report.findings.filter(
        (_, index) =>
          !verification.verifications.some(
            (item) => item.findingIndex === index && item.confirmed,
          ),
      )
    : []
  const renderedReport = renderReviewReport(finalReport)
  await recorder.writeJson("review-report.json", finalReport)
  await recorder.writeJson("rejected-findings.json", rejectedFindings)
  await recorder.writeText("rendered-comment.md", renderedReport)
  logger.info("Review agent stage completed", {
    ...context,
    stage: "generation",
    finishReason: generation.finishReason,
    usage: generation.totalUsage,
    mergeSafetyScore: finalReport.mergeSafetyScore,
    findings: finalReport.findings.length,
    candidateFindings: report.findings.length,
  })
  await recorder.appendEvent("stage.completed", {
    stage: "generation",
    finishReason: generation.finishReason,
    usage: generation.totalUsage,
    mergeSafetyScore: finalReport.mergeSafetyScore,
    findings: finalReport.findings.length,
    candidateFindings: report.findings.length,
  })

  logger.info("Review agent stage started", { ...context, stage: "publish" })
  await recorder.appendEvent("stage.started", { stage: "publish" })
  await updateReviewComment({
    repo: repository,
    installationId,
    commentId,
    pullRequestId: pullRequest.id,
    body: renderedReport,
  })
  const result = {
    kind: "summary" as const,
    summary: renderedReport,
    triggerSource,
    modelId: REVIEW_MODEL,
    verifierModelId: REVIEW_VERIFIER_MODEL,
    fetchedFileCount: files.length,
    filteredFileCount: filteredFiles.length,
    diffCharacterCount,
    commentId,
    mergeSafetyScore: finalReport.mergeSafetyScore,
    usage: {
      review: generation.totalUsage,
      verification: verificationUsage,
    } as unknown as Record<string, unknown>,
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
    qdrantEnabled: Boolean(runtime.qdrant),
    qdrantChunks,
    qdrantIndexedFiles,
    qdrantIgnoredFiles,
    candidateFindings: report.findings.length,
    confirmedFindings: finalReport.findings.length,
    rejectedFindings: rejectedFindings.length,
    mergeSafetyScore: finalReport.mergeSafetyScore,
    usage: result.usage,
    counts: recorder.counts(),
    durationMs: result.durationMs,
  })
  await recorder.writeText("published-comment.md", renderedReport)
  logger.info("Review agent stage completed", {
    ...context,
    stage: "publish",
    commentId,
    durationMs: result.durationMs,
  })
  await recorder.appendEvent("stage.completed", {
    stage: "publish",
    commentId,
    durationMs: result.durationMs,
  })
  await recorder.appendEvent("review.completed", result)
  return result
}

export const publishReviewFailure = async ({
  pullRequest,
  repository,
  installationId,
}: Pick<RunInput, "pullRequest" | "repository" | "installationId">) => {
  const commentId = await findOrCreateReviewComment({
    repo: repository,
    installationId,
    pullRequestNumber: pullRequest.number,
    pullRequestId: pullRequest.id,
  })
  await updateReviewComment({
    repo: repository,
    installationId,
    commentId,
    pullRequestId: pullRequest.id,
    body: reviewFailedBody,
  })
  return commentId
}
