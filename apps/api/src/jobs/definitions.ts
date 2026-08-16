import { randomUUID } from "node:crypto"
import { sql, type SQL } from "drizzle-orm"
import { z } from "zod"

export type JobExecutor = {
  execute: (query: SQL) => Promise<unknown>
}

const enqueueJob = (
  executor: JobExecutor,
  jobName: string,
  payload: Record<string, unknown>,
  idempotencyKey: string
) => {
  const id = randomUUID()
  return executor.execute(sql`
    insert into job_outbox (id, job_name, payload, idempotency_key)
    values (${id}, ${jobName}, ${JSON.stringify(payload)}::jsonb, ${idempotencyKey})
    on conflict (idempotency_key)
      where published_at is null and failed_at is null
      do nothing
  `)
}

export const jobNames = {
  processGitHubWebhook: "process-github-webhook",
  reviewPullRequest: "review-pull-request",
  crawlDocSource: "crawl-doc-source",
  distillReviewMemory: "distill-review-memory",
  syncRepositoryPullRequests: "sync-repository-pull-requests",
} as const

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
  syncRepositoryPullRequests: z.object({
    repositoryId: z.string().min(1),
  }),
}

export const jobs = {
  processGitHubWebhook: {
    enqueue: (
      executor: JobExecutor,
      payload: z.infer<typeof jobPayloadSchemas.processGitHubWebhook>
    ) =>
      enqueueJob(
        executor,
        jobNames.processGitHubWebhook,
        payload,
        `github-webhook:${payload.webhookEventId}`
      ),
  },
  reviewPullRequest: {
    enqueue: (
      executor: JobExecutor,
      payload: z.infer<typeof jobPayloadSchemas.reviewPullRequest>
    ) =>
      enqueueJob(
        executor,
        jobNames.reviewPullRequest,
        payload,
        `pull-request-review:${payload.reviewRunId}`
      ),
  },
  crawlDocSource: {
    enqueue: (
      executor: JobExecutor,
      payload: z.infer<typeof jobPayloadSchemas.crawlDocSource>
    ) =>
      enqueueJob(
        executor,
        jobNames.crawlDocSource,
        payload,
        `docs-crawl:${payload.sourceId}`
      ),
  },
  distillReviewMemory: {
    enqueue: (
      executor: JobExecutor,
      payload: z.infer<typeof jobPayloadSchemas.distillReviewMemory>
    ) =>
      enqueueJob(
        executor,
        jobNames.distillReviewMemory,
        payload,
        `review-memory:${payload.commentId}`
      ),
  },
  syncRepositoryPullRequests: {
    enqueue: (
      executor: JobExecutor,
      payload: z.infer<typeof jobPayloadSchemas.syncRepositoryPullRequests>
    ) =>
      enqueueJob(
        executor,
        jobNames.syncRepositoryPullRequests,
        payload,
        `repository-pull-requests:${payload.repositoryId}`
      ),
  },
}
