import { randomUUID } from "node:crypto"
import { and, eq } from "drizzle-orm"
import { Elysia } from "elysia"
import { db } from "../../db/client"
import { webhookEvent, workspace } from "../../db/schema"
import {
  enqueueGitHubWebhookEvent,
  type GitHubWebhookPayload,
  verifyGitHubWebhook,
} from "../../services/webhook-events"

const findWorkspaceByInstallationId = async (installationId?: number) => {
  if (!installationId) {
    return null
  }

  return db.query.workspace.findFirst({
    where: eq(workspace.providerInstallationId, String(installationId)),
  })
}

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
      const isValid = await verifyGitHubWebhook(payloadText, signature)

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
      const relatedWorkspace = await findWorkspaceByInstallationId(
        payload.installation?.id,
      )

      await db.transaction(async (tx) => {
        const [savedWebhookEvent] = await tx
          .insert(webhookEvent)
          .values({
            id: randomUUID(),
            provider: "github",
            deliveryId,
            eventName,
            action: payload.action ?? null,
            workspaceId: relatedWorkspace?.id ?? null,
            payload: payload as Record<string, unknown>,
          })
          .onConflictDoNothing({
            target: [webhookEvent.provider, webhookEvent.deliveryId],
          })
          .returning()

        const event =
          savedWebhookEvent ??
          (await tx.query.webhookEvent.findFirst({
            where: and(
              eq(webhookEvent.provider, "github"),
              eq(webhookEvent.deliveryId, deliveryId),
            ),
          }))

        if (event && !event.processedAt) {
          await enqueueGitHubWebhookEvent(event.id, tx)
        }
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
