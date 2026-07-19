import { z } from "zod"
import { enqueueJob, type JobExecutor } from "./queue"

export const jobPayloadSchemas = {
  processGitHubWebhook: z.object({
    webhookEventId: z.uuid(),
  }),
  reviewPullRequest: z.object({
    reviewRunId: z.uuid(),
  }),
  crawlDocSource: z.object({
    sourceId: z.string().min(1),
  }),
  distillReviewMemory: z.object({
    repositoryId: z.string().min(1),
    commentId: z.number().int().positive(),
  }),
}

export const jobs = {
  processGitHubWebhook: {
    enqueue: (
      executor: JobExecutor,
      payload: z.infer<typeof jobPayloadSchemas.processGitHubWebhook>,
    ) =>
      enqueueJob(executor, "process_github_webhook", payload, {
        jobKey: `github-webhook:${payload.webhookEventId}`,
      }),
  },
  reviewPullRequest: {
    enqueue: (
      executor: JobExecutor,
      payload: z.infer<typeof jobPayloadSchemas.reviewPullRequest>,
    ) =>
      enqueueJob(executor, "review_pull_request", payload, {
        jobKey: `pull-request-review:${payload.reviewRunId}`,
        maxAttempts: 5,
      }),
  },
  crawlDocSource: {
    enqueue: (
      executor: JobExecutor,
      payload: z.infer<typeof jobPayloadSchemas.crawlDocSource>,
    ) =>
      enqueueJob(executor, "crawl_doc_source", payload, {
        jobKey: `docs-crawl:${payload.sourceId}`,
        maxAttempts: 3,
      }),
  },
  distillReviewMemory: {
    enqueue: (
      executor: JobExecutor,
      payload: z.infer<typeof jobPayloadSchemas.distillReviewMemory>,
    ) =>
      enqueueJob(executor, "distill_review_memory", payload, {
        jobKey: `review-memory:${payload.commentId}`,
        maxAttempts: 3,
      }),
  },
}
