import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import { Output, ToolLoopAgent, tool } from "ai"
import {
  buildDiffContext,
  getSymbolCallers,
  getSymbolDefinition,
  indexReviewCodebase,
  readRepositoryFile,
  renderReadableDiffContext,
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
  renderReviewReport,
  reviewReportSchema,
} from "./prompt"
import { createReviewRunRecorder } from "./debug-run"
import { prepareReviewRuntime } from "./runtime"

export const REVIEW_MODEL = "openai/gpt-5.5"

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
  })
  const diffContext = await buildDiffContext({
    repository: runtime.paths.repositoryPath,
    diffFiles: parseUnifiedDiff(unifiedDiff),
  })
  const diffContextMarkdown = renderReadableDiffContext(diffContext)
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
  await recorder.writeText("context/diff-context.md", diffContextMarkdown)
  let semanticContextMarkdown: string | null = null
  let qdrantChunks = 0
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
    const semanticContext = await searchReviewCode({
      repositoryId: repository.id,
      headSha: pullRequest.headSha,
      reviewRunId,
      qdrant: runtime.qdrant,
      query: [
        pullRequest.title,
        pullRequest.body ?? "",
        diffContext.files
          .flatMap((file) =>
            file.affectedSymbols
              .map((symbol) => symbol.source)
              .concat(file.patch)
          )
          .join("\n"),
      ].join("\n"),
      limit: 10,
    })
    semanticContextMarkdown = semanticContext.markdown
    await recorder.writeJson("context/semantic-context.json", {
      chunks: semanticContext.chunks,
      stats: semanticContext.stats,
    })
    await recorder.writeText(
      "context/semantic-context.md",
      semanticContextMarkdown
    )
  }
  logger.info("Review agent stage completed", {
    ...context,
    stage: "runtime",
    repositoryPath: runtime.paths.repositoryPath,
    diagnostics: runtime.codeIndex.diagnostics.length,
    qdrantEnabled: Boolean(runtime.qdrant),
    qdrantChunks,
  })
  await recorder.appendEvent("stage.completed", {
    stage: "runtime",
    repositoryPath: runtime.paths.repositoryPath,
    diagnostics: runtime.codeIndex.diagnostics.length,
    qdrantEnabled: Boolean(runtime.qdrant),
    qdrantChunks,
  })

  logger.info("Review agent stage started", { ...context, stage: "generation" })
  await recorder.appendEvent("stage.started", { stage: "generation" })
  const openrouter = createOpenRouter({ apiKey: requireOpenRouterApiKey() })
  const tools = {
    read_file: tool({
      description:
        "Read a repository file by repo-relative path. Use startLine and maxLines for focused context.",
      inputSchema: z.object({
        file: z.string().min(1),
        startLine: z.number().int().positive().optional(),
        maxLines: z.number().int().positive().max(500).optional(),
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
        "Get definitions and enclosing source context for a symbol name in the repository.",
      inputSchema: z.object({
        symbol: z.string().min(1),
      }),
      execute: async ({ symbol }) => {
        const input = { symbol }
        const result = await getSymbolDefinition({
          repository: runtime.paths.repositoryPath,
          index: runtime.codeIndex,
          symbol,
        })
        const output = {
          ...result.stats,
          markdown: toolText(result.markdown),
        }
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
        "Get direct callers for a symbol name, optionally including caller definitions.",
      inputSchema: z.object({
        symbol: z.string().min(1),
        includeCallerDefinitions: z.boolean().optional(),
        includeUnresolved: z.boolean().optional(),
      }),
      execute: async ({
        symbol,
        includeCallerDefinitions = false,
        includeUnresolved = true,
      }) => {
        const input = { symbol, includeCallerDefinitions, includeUnresolved }
        const result = await getSymbolCallers({
          repository: runtime.paths.repositoryPath,
          index: runtime.codeIndex,
          symbol,
          includeCallerDefinitions,
          includeUnresolved,
        })
        const output = {
          ...result.stats,
          markdown: toolText(result.markdown),
        }
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
    diffContext: diffContextMarkdown,
    semanticContext: semanticContextMarkdown,
  })
  await recorder.writeText("context/prompt.txt", prompt)
  const generation = await reviewAgent.generate({
    prompt,
  })
  const report = reviewReportSchema.parse(generation.output)
  const renderedReport = renderReviewReport(report)
  await recorder.writeJson("agent-output.json", {
    finishReason: generation.finishReason,
    usage: generation.totalUsage,
    output: generation.output,
    text: generation.text,
  })
  await recorder.writeJson("review-report.json", report)
  await recorder.writeText("rendered-comment.md", renderedReport)
  logger.info("Review agent stage completed", {
    ...context,
    stage: "generation",
    finishReason: generation.finishReason,
    usage: generation.totalUsage,
    mergeSafetyScore: report.mergeSafetyScore,
    findings: report.findings.length,
  })
  await recorder.appendEvent("stage.completed", {
    stage: "generation",
    finishReason: generation.finishReason,
    usage: generation.totalUsage,
    mergeSafetyScore: report.mergeSafetyScore,
    findings: report.findings.length,
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
    fetchedFileCount: files.length,
    filteredFileCount: filteredFiles.length,
    diffCharacterCount,
    commentId,
    mergeSafetyScore: report.mergeSafetyScore,
    usage: generation.totalUsage as unknown as Record<string, unknown>,
    startedAt: startedAtIso,
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
  }
  await recorder.writeJson("result.json", result)
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
