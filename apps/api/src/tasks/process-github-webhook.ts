import type { Task } from "graphile-worker"
import { z } from "zod"
import { processGitHubWebhookEvent } from "../services/webhook-events"

const payloadSchema = z.object({
  webhookEventId: z.uuid(),
})

export const processGitHubWebhook: Task = async (payload, helpers) => {
  const { webhookEventId } = payloadSchema.parse(payload)

  try {
    await processGitHubWebhookEvent(webhookEventId)
  } catch (error) {
    helpers.logger.error("Failed to process GitHub webhook", {
      webhookEventId,
      error,
    })
    throw error
  }
}
