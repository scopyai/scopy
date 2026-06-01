import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import { generateText } from "ai"
import { env } from "../../env"
import type { pullRequest, repository, reviewConfig } from "../../db/schema"
import {
  filterPullRequestFiles,
  getDiffSkipReason,
  serializePullRequestFiles,
} from "./diff"
import {
  findOrCreateReviewComment,
  listPullRequestFiles,
  reviewFailedBody,
  updateReviewComment,
} from "./github"
import { buildPullRequestSummaryPrompt } from "./prompt"

export const REVIEW_MODEL = "openai/gpt-5.4-mini"

type Logger = {
  info: (message: string, details?: Record<string, unknown>) => void
  error: (message: string, details?: Record<string, unknown>) => void
}

type RunInput = {
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

export const runReviewAgent = async ({
  pullRequest,
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

  logger.info("Review agent stage started", { ...context, stage: "diff" })
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
  const diffCharacterCount = diff.length
  logger.info("Review agent stage completed", {
    ...context,
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
    logger.info("Review agent skipped", { ...context, ...result })
    return result
  }

  logger.info("Review agent stage started", { ...context, stage: "generation" })
  const openrouter = createOpenRouter({ apiKey: requireOpenRouterApiKey() })
  const generation = await generateText({
    model: openrouter.chat(REVIEW_MODEL),
    prompt: buildPullRequestSummaryPrompt({
      title: pullRequest.title,
      body: pullRequest.body,
      baseRef: pullRequest.baseRef,
      headRef: pullRequest.headRef,
      diff,
    }),
    maxRetries: 2,
  })
  logger.info("Review agent stage completed", {
    ...context,
    stage: "generation",
    finishReason: generation.finishReason,
    usage: generation.totalUsage,
  })

  logger.info("Review agent stage started", { ...context, stage: "publish" })
  await updateReviewComment({
    repo: repository,
    installationId,
    commentId,
    pullRequestId: pullRequest.id,
    body: generation.text,
  })
  const result = {
    kind: "summary" as const,
    summary: generation.text,
    triggerSource,
    modelId: REVIEW_MODEL,
    fetchedFileCount: files.length,
    filteredFileCount: filteredFiles.length,
    diffCharacterCount,
    commentId,
    usage: generation.totalUsage as unknown as Record<string, unknown>,
    startedAt: startedAtIso,
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
  }
  logger.info("Review agent stage completed", {
    ...context,
    stage: "publish",
    commentId,
    durationMs: result.durationMs,
  })
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
