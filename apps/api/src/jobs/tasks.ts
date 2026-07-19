import type { TaskList } from "graphile-worker"
import { crawlDocSource } from "../modules/docs/crawler"
import { enqueueDueDocSourceCrawls } from "../modules/docs/service"
import { distillReviewMemory } from "../modules/reviews/memories"
import { executeReviewPullRequest } from "../modules/reviews/task"
import { processGitHubWebhookEvent } from "../modules/webhooks/service"
import { jobPayloadSchemas } from "./definitions"
import { workerEnv } from "../env"

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
      }
    )
  },
  distill_review_memory: async (payload, helpers) => {
    await distillReviewMemory({
      ...jobPayloadSchemas.distillReviewMemory.parse(payload),
      logger: helpers.logger,
    })
  },
  crawl_doc_source: async (payload, helpers) => {
    const { sourceId } = jobPayloadSchemas.crawlDocSource.parse(payload)
    await crawlDocSource({ sourceId, logger: helpers.logger })
  },
  crawl_all_doc_sources: async (_payload, helpers) => {
    await enqueueDueDocSourceCrawls({
      logger: helpers.logger,
      intervalHours: workerEnv.DOCS_RECRAWL_INTERVAL_HOURS,
    })
  },
}
