import { run, type TaskList } from "graphile-worker"
import { z } from "zod"
import { env } from "./env"
import { processGitHubWebhookEvent } from "./modules/webhooks/service"
import { reviewPullRequest } from "./modules/reviews/task"

const webhookPayloadSchema = z.object({
  webhookEventId: z.uuid(),
})

const taskList: TaskList = {
  process_github_webhook: async (payload, helpers) => {
    const { webhookEventId } = webhookPayloadSchema.parse(payload)

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
  review_pull_request: reviewPullRequest,
}

const runner = await run({
  connectionString: env.DATABASE_URL,
  concurrency: 5,
  taskList,
})

await runner.promise
