import { Elysia } from "elysia"
import { Webhooks } from "@octokit/webhooks"
import { apiEnv } from "../../env"
import { parseCreemWebhook, verifyCreemWebhookSignature } from "../billing/creem"
import { applyCreemWebhook } from "../billing/service"
import { persistGitHubWebhookEvent, type GitHubWebhookPayload } from "./service"

export const webhookRoutes = new Elysia({ prefix: "/webhooks" })
  .post("/creem", async ({ request, status }) => {
    const payloadText = await request.text()
    if (!verifyCreemWebhookSignature(payloadText, request.headers.get("creem-signature"))) {
      return status(401, { error: "Invalid Creem webhook signature" })
    }

    try {
      await applyCreemWebhook(parseCreemWebhook(payloadText))
      return { ok: true }
    } catch (error) {
      console.error("Failed to process Creem webhook", { error })
      return status(500, { error: "Failed to process Creem webhook" })
    }
  })
  .post("/github", async ({ request, status }) => {
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
      if (!apiEnv.GITHUB_APP_WEBHOOK_SECRET) {
        throw new Error("GitHub webhooks are not configured")
      }
      const isValid = await new Webhooks({
        secret: apiEnv.GITHUB_APP_WEBHOOK_SECRET,
      }).verify(payloadText, signature)

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
  })
