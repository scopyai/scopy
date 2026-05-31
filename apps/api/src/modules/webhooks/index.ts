import { Elysia } from "elysia"
import { createGitHubWebhooks } from "../../services/github"
import {
  persistGitHubWebhookEvent,
  type GitHubWebhookPayload,
} from "../../services/webhook-events"

export const webhookRoutes = new Elysia({ prefix: "/webhooks" }).post(
  "/github",
  async ({ request, status }) => {
    const deliveryId = request.headers.get("x-github-delivery")
    const eventName = request.headers.get("x-github-event")
    const signature = request.headers.get("x-hub-signature-256")
    const payloadText = await request.text()

    if (!deliveryId || !eventName || !signature) {
      console.warn("Rejected GitHub webhook with missing headers", {
        deliveryId,
        eventName,
        hasSignature: Boolean(signature),
      })
      return status(400, { error: "Missing GitHub webhook headers" })
    }

    try {
      const isValid = await createGitHubWebhooks().verify(payloadText, signature)

      if (!isValid) {
        console.warn("Rejected GitHub webhook with invalid signature", {
          deliveryId,
          eventName,
        })
        return status(401, { error: "Invalid GitHub webhook signature" })
      }
    } catch (error) {
      console.error("Failed to verify GitHub webhook", {
        deliveryId,
        eventName,
        error,
      })
      return status(503, { error: "GitHub webhooks are not configured" })
    }

    let payload: GitHubWebhookPayload

    try {
      payload = JSON.parse(payloadText) as GitHubWebhookPayload
    } catch (error) {
      console.warn("Rejected GitHub webhook with invalid JSON", {
        deliveryId,
        eventName,
        error,
      })
      return status(400, { error: "Invalid GitHub webhook payload" })
    }

    try {
      await persistGitHubWebhookEvent({
        deliveryId,
        eventName,
        payload,
      })
    } catch (error) {
      console.error("Failed to persist or enqueue GitHub webhook", {
        deliveryId,
        eventName,
        action: payload.action ?? null,
        installationId: payload.installation?.id ?? null,
        error,
      })
      return status(500, { error: "Failed to enqueue GitHub webhook" })
    }

    return status(202, {
      ok: true,
    })
  },
)
