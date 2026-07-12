import type { TaskList } from "graphile-worker"
import { crawlDocSource } from "../modules/docs/crawler"
import { enqueueDueDocSourceCrawls } from "../modules/docs/service"
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
  crawl_doc_source: async (payload, helpers) => {
    const { slug } = jobPayloadSchemas.crawlDocSource.parse(payload)
    await crawlDocSource({ slug, logger: helpers.logger })
  },
  crawl_all_doc_sources: async (_payload, helpers) => {
    await enqueueDueDocSourceCrawls({ logger: helpers.logger })
  },
}
