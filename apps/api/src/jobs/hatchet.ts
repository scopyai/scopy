import {
  HatchetClient,
  type BaseWorkflowDeclaration,
  type Context,
} from "@hatchet-dev/typescript-sdk/v1"
import { z } from "zod"
import { workerEnv } from "../env-worker"
import { crawlDocSource } from "../modules/docs/crawler"
import { enqueueDueDocSourceCrawls } from "../modules/docs/service"
import { distillReviewMemory } from "../modules/reviews/memories"
import {
  analyzeReviewPullRequest,
  cleanupReviewPullRequestArtifacts,
  failReviewPullRequest,
  finalizeReviewPullRequest,
  prepareReviewPullRequest,
  publishReviewPullRequest,
  type JobLogger,
} from "../modules/reviews/task"
import { processGitHubWebhookEvent } from "../modules/webhooks/service"
import { jobNames, jobPayloadSchemas } from "./definitions"

const dispatchSchema = z.object({ dispatchId: z.uuid() })
const retryPolicy = {
  retries: 1,
  backoff: { factor: 2, maxSeconds: 60 },
  scheduleTimeout: "2h",
} as const
const idempotency = {
  strategy: "ttl" as const,
  expression: "input.dispatchId",
  ttlMs: 7 * 24 * 60 * 60 * 1_000,
}
const activeRunIdempotency = (expression: string, fallbackTtlMs: number) => ({
  strategy: "status" as const,
  expression,
  fallbackTtlMs,
})

const loggerFor = (ctx: Pick<Context<any>, "logger">): JobLogger => ({
  info: (message, details) => void ctx.logger.info(message, details),
  error: (message, details) => void ctx.logger.error(message, details),
})

export const createHatchetClient = () => HatchetClient.init()

export const createHatchetJobs = (
  hatchet: ReturnType<typeof createHatchetClient>
) => {
  const processGitHubWebhookSchema = dispatchSchema.extend(
    jobPayloadSchemas.processGitHubWebhook.shape
  )
  const processGitHubWebhook = hatchet.task<
    z.infer<typeof processGitHubWebhookSchema>,
    void
  >({
    name: jobNames.processGitHubWebhook,
    inputValidator: processGitHubWebhookSchema,
    idempotency: activeRunIdempotency("input.webhookEventId", 30 * 60 * 1_000),
    ...retryPolicy,
    executionTimeout: "10m",
    fn: async (input, ctx) => {
      try {
        await processGitHubWebhookEvent(input.webhookEventId)
      } catch (error) {
        await ctx.logger.error(
          `Failed to process GitHub webhook ${input.webhookEventId}`,
          {
            error: error instanceof Error ? error : new Error(String(error)),
          }
        )
        throw error
      }
    },
  })

  const crawlDocsSchema = dispatchSchema.extend(
    jobPayloadSchemas.crawlDocSource.shape
  )
  const crawlDocs = hatchet.task<z.infer<typeof crawlDocsSchema>, void>({
    name: jobNames.crawlDocSource,
    inputValidator: crawlDocsSchema,
    idempotency: activeRunIdempotency("input.sourceId", 2 * 60 * 60 * 1_000),
    ...retryPolicy,
    executionTimeout: "1h",
    fn: async (input, ctx) => {
      await crawlDocSource({ sourceId: input.sourceId, logger: loggerFor(ctx) })
    },
  })

  const distillMemorySchema = dispatchSchema.extend(
    jobPayloadSchemas.distillReviewMemory.shape
  )
  const distillMemory = hatchet.task<z.infer<typeof distillMemorySchema>, void>(
    {
      name: jobNames.distillReviewMemory,
      inputValidator: distillMemorySchema,
      idempotency,
      ...retryPolicy,
      executionTimeout: "30m",
      fn: (input, ctx) =>
        distillReviewMemory({
          repositoryId: input.repositoryId,
          commentId: input.commentId,
          logger: loggerFor(ctx),
        }),
    }
  )

  const docsSweep = hatchet.task<Record<string, never>, { enqueued: string[] }>(
    {
      name: "crawl-all-doc-sources",
      onCrons: ["0 * * * *"],
      ...retryPolicy,
      executionTimeout: "10m",
      fn: async (_input, ctx) => ({
        enqueued: await enqueueDueDocSourceCrawls({
          logger: loggerFor(ctx),
          intervalHours: workerEnv.DOCS_RECRAWL_INTERVAL_HOURS,
        }),
      }),
    }
  )

  const reviewInputSchema = dispatchSchema.extend(
    jobPayloadSchemas.reviewPullRequest.shape
  )
  type ReviewInput = z.infer<typeof reviewInputSchema>
  const review = hatchet.workflow<ReviewInput>({
    name: jobNames.reviewPullRequest,
    inputValidator: reviewInputSchema,
    idempotency,
  })
  const prepare = review.task({
    name: "prepare-review",
    ...retryPolicy,
    executionTimeout: "10m",
    fn: (input, ctx) => prepareReviewPullRequest(input, loggerFor(ctx)),
  })
  const analyze = review.task({
    name: "analyze-review",
    parents: [prepare],
    ...retryPolicy,
    executionTimeout: "2h",
    fn: (input, ctx) => analyzeReviewPullRequest(input, loggerFor(ctx)),
  })
  const publish = review.task({
    name: "publish-review",
    parents: [analyze],
    ...retryPolicy,
    executionTimeout: "15m",
    fn: (input, ctx) => publishReviewPullRequest(input, loggerFor(ctx)),
  })
  review.task({
    name: "finalize-review",
    parents: [publish],
    ...retryPolicy,
    executionTimeout: "10m",
    fn: async (input, ctx) => {
      const logger = loggerFor(ctx)
      try {
        await finalizeReviewPullRequest(input, logger)
      } finally {
        await cleanupReviewPullRequestArtifacts(input, logger)
      }
    },
  })
  review.onFailure({
    name: "fail-review",
    retries: 5,
    backoff: retryPolicy.backoff,
    executionTimeout: "10m",
    fn: async (input, ctx) => {
      const logger = loggerFor(ctx)
      try {
        const errors = ctx.errors()
        await failReviewPullRequest(
          input,
          logger,
          new Error(JSON.stringify(errors))
        )
      } finally {
        await cleanupReviewPullRequestArtifacts(input, logger)
      }
    },
  })

  const workflows = [
    processGitHubWebhook,
    review,
    crawlDocs,
    distillMemory,
    docsSweep,
  ]
  const byName: Record<string, BaseWorkflowDeclaration<any, any>> = {
    [jobNames.processGitHubWebhook]: processGitHubWebhook,
    [jobNames.reviewPullRequest]: review,
    [jobNames.crawlDocSource]: crawlDocs,
    [jobNames.distillReviewMemory]: distillMemory,
  }

  return { workflows, byName }
}
