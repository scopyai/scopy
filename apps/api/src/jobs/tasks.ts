import type { TaskList } from "graphile-worker"
import { executeReviewPullRequest } from "../modules/reviews/task"
import { processGitHubWebhookEvent } from "../modules/webhooks/service"
import { jobPayloadSchemas } from "./definitions"

export const taskList: TaskList = {
  process_github_webhook: async (payload, helpers) => {
    const { webhookEventId } =
      jobPayloadSchemas.processGitHubWebhook.parse(payload)

    try {
      await processGitHubWebhookEvent(webhookEventId)
    } catch (error) {
      helpers.logger.error("Failed to process GitHub webhook", {
        webhookEventId,
        error,
      })
      throw error
    }
  },
  review_pull_request: async (payload, helpers) => {
    await executeReviewPullRequest(
      jobPayloadSchemas.reviewPullRequest.parse(payload),
      {
        logger: helpers.logger,
        attempt: helpers.job.attempts,
        maxAttempts: helpers.job.max_attempts,
      },
    )
  },
}
