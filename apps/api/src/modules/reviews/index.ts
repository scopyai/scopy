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
  filterReportToValidEvidence,
  validateReviewReportEvidence,
  type ReviewReportEvidenceValidation,
} from "./evidence"
import {
  buildReviewAgentPrompt,
  buildReviewAgentRepairPrompt,
  buildReviewVerifierPrompt,
  renderAffectedSymbols,
  renderReviewReport,
  renderSemanticCoverage,
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
  const parsedDiffFiles = parseUnifiedDiff(unifiedDiff)
  const diffContext = await buildDiffContext({
    repository: runtime.paths.repositoryPath,
    diffFiles: parsedDiffFiles,
  })
  const affectedSymbols = renderAffectedSymbols(diffContext)
  const semanticChunks = chunksForRepositoryIndex({
    index: runtime.codeIndex,
    repositoryKey: `${repository.id}:${pullRequest.headSha}`,
  })
  const semanticCoverage = renderSemanticCoverage({
    diffContext,
    codeIndex: runtime.codeIndex,
    chunks: semanticChunks,
    qdrantEnabled: Boolean(runtime.qdrant),
  })
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
  await recorder.writeJson("context/semantic-chunks.json", semanticChunks)
  await recorder.writeText("context/semantic-coverage.md", semanticCoverage)
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
    search_text: tool({
      description:
        "Literal grep-style repository search. Use this for exact identifiers, route paths, config keys, env vars, table/column names, error strings, imports, filenames, and other concrete text. Returns matching lines with small surrounding context.",
      inputSchema: z.object({
        query: z.string().min(1),
        caseSensitive: z.boolean().optional(),
        maxResults: z.number().int().positive().max(100).optional(),
        contextLines: z.number().int().min(0).max(5).optional(),
      }),
      execute: async ({
        query,
        caseSensitive = false,
        maxResults = 50,
        contextLines = 1,
      }) => {
        const input = { query, caseSensitive, maxResults, contextLines }
        const result = await searchRepositoryText({
          repository: runtime.paths.repositoryPath,
          index: runtime.codeIndex,
          query,
          caseSensitive,
          maxResults,
          contextLines,
        })
        const output = {
          ...result.stats,
          markdown: toolText(result.markdown),
        }
        await recorder.recordToolCall({ name: "search_text", input, output })
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
    semanticCoverage,
  })
  await recorder.writeText("context/prompt.txt", prompt)
  await recorder.writeJson("context/prompt-stats.json", {
    diffBytes: textBytes(diff),
    affectedSymbolsBytes: textBytes(affectedSymbols),
    semanticCoverageBytes: textBytes(semanticCoverage),
    promptBytes: textBytes(prompt),
    semanticContextPreloaded: false,
  })
  const generation = await reviewAgent.generate({
    prompt,
  })
  const initialReport = reviewReportSchema.parse(generation.output)
  await recorder.writeJson("agent-output.json", {
    finishReason: generation.finishReason,
    usage: generation.totalUsage,
    output: generation.output,
    text: generation.text,
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
    reportValidation,
  )
  let repairUsage: unknown
  if (!reportValidation.valid) {
    logger.info("Review agent stage started", {
      ...context,
      stage: "evidence-repair",
      invalidFindings: reportValidation.findings.filter(
        (finding) => !finding.valid,
      ).length,
    })
    await recorder.appendEvent("stage.started", {
      stage: "evidence-repair",
      invalidFindings: reportValidation.findings.filter(
        (finding) => !finding.valid,
      ).length,
    })
    const repairPrompt = buildReviewAgentRepairPrompt({
      originalPrompt: prompt,
      report,
      validation: {
        ...reportValidation,
        findings: reportValidation.findings.filter(
          (finding) => !finding.valid,
        ),
      },
    })
    await recorder.writeText("context/repair-prompt.txt", repairPrompt)
    await recorder.writeJson("context/repair-prompt-stats.json", {
      promptBytes: textBytes(repairPrompt),
      invalidFindings: reportValidation.findings.filter(
        (finding) => !finding.valid,
      ).length,
    })
    const repairGeneration = await reviewAgent.generate({
      prompt: repairPrompt,
    })
    repairUsage = repairGeneration.totalUsage
    report = reviewReportSchema.parse(repairGeneration.output)
    await recorder.writeJson("agent-repair-output.json", {
      finishReason: repairGeneration.finishReason,
      usage: repairGeneration.totalUsage,
      output: repairGeneration.output,
      text: repairGeneration.text,
    })
    await recorder.writeJson("repaired-candidate-review-report.json", report)
    reportValidation = await validateReviewReportEvidence({
      repository: runtime.paths.repositoryPath,
      diffFiles: parsedDiffFiles,
      report,
    })
    await recorder.writeJson(
      "repaired-candidate-review-report-validation.json",
      reportValidation,
    )
    logger.info("Review agent stage completed", {
      ...context,
      stage: "evidence-repair",
      usage: repairGeneration.totalUsage,
      findings: report.findings.length,
      invalidFindings: reportValidation.findings.filter(
        (finding) => !finding.valid,
      ).length,
    })
    await recorder.appendEvent("stage.completed", {
      stage: "evidence-repair",
      usage: repairGeneration.totalUsage,
      findings: report.findings.length,
      invalidFindings: reportValidation.findings.filter(
        (finding) => !finding.valid,
      ).length,
    })
  }
  const invalidEvidenceFindings = report.findings.filter(
    (_, index) => !reportValidation.findings[index]?.valid,
  )
  report = filterReportToValidEvidence(report, reportValidation)
  await recorder.writeJson(
    "evidence-filtered-findings.json",
    invalidEvidenceFindings,
  )
  await recorder.writeJson("evidence-validated-review-report.json", report)
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
      semanticCoverage,
      report,
    })
    await recorder.writeText("context/verification-prompt.txt", verificationPrompt)
    await recorder.writeJson("context/verification-prompt-stats.json", {
      promptBytes: textBytes(verificationPrompt),
      semanticCoverageBytes: textBytes(semanticCoverage),
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
    generatedCandidateFindings: initialReport.findings.length,
    evidenceFilteredFindings: invalidEvidenceFindings.length,
  })
  await recorder.appendEvent("stage.completed", {
    stage: "generation",
    finishReason: generation.finishReason,
    usage: generation.totalUsage,
    mergeSafetyScore: finalReport.mergeSafetyScore,
    findings: finalReport.findings.length,
    candidateFindings: report.findings.length,
    generatedCandidateFindings: initialReport.findings.length,
    evidenceFilteredFindings: invalidEvidenceFindings.length,
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
      repair: repairUsage,
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
    generatedCandidateFindings: initialReport.findings.length,
    evidenceFilteredFindings: invalidEvidenceFindings.length,
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
