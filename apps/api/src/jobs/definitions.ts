import { z } from "zod"
import { enqueueJob, type JobExecutor } from "./queue"

export const jobPayloadSchemas = {
  processGitHubWebhook: z.object({
    webhookEventId: z.uuid(),
  }),
  reviewPullRequest: z.object({
    reviewRunId: z.uuid(),
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
}
