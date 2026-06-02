import { randomUUID } from "node:crypto"
import { and, eq, isNull, lt, or } from "drizzle-orm"
import { db } from "../../db/client"
import { webhookEvent, workspace } from "../../db/schema"
import { jobs } from "../../jobs/definitions"
import { schedulePullRequestReview } from "../reviews/service"
import {
  handleGitHubWebhook,
  type GitHubWebhookPayload,
  type PullRequestReviewRequest,
} from "./github"

const findWorkspaceByInstallationId = async (installationId?: number) => {
  if (!installationId) {
    return null
  }

  return db.query.workspace.findFirst({
    where: eq(workspace.providerInstallationId, String(installationId)),
  })
}

const finishWebhookEvent = async (
  eventId: string,
  review?: PullRequestReviewRequest,
) => {
  await db.transaction(async (tx) => {
    if (review) {
      await schedulePullRequestReview(tx, {
        webhookEventId: eventId,
        ...review,
      })
    }

    await tx
      .update(webhookEvent)
      .set({
        processedAt: new Date(),
        processingStartedAt: null,
        processingError: null,
      })
      .where(eq(webhookEvent.id, eventId))
  })
}

export const persistGitHubWebhookEvent = async ({
  deliveryId,
  eventName,
  payload,
}: {
  deliveryId: string
  eventName: string
  payload: GitHubWebhookPayload
}) => {
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
      await jobs.processGitHubWebhook.enqueue(tx, {
        webhookEventId: event.id,
      })
    }
  })
}

const claimGitHubWebhookEvent = async (eventId: string) => {
  const leaseExpiredAt = new Date(Date.now() - 60 * 60 * 1000)
  const [event] = await db
    .update(webhookEvent)
    .set({
      processingStartedAt: new Date(),
      processingError: null,
    })
    .where(
      and(
        eq(webhookEvent.id, eventId),
        isNull(webhookEvent.processedAt),
        or(
          isNull(webhookEvent.processingStartedAt),
          lt(webhookEvent.processingStartedAt, leaseExpiredAt),
        ),
      ),
    )
    .returning()

  if (event) {
    return event
  }

  const existingEvent = await db.query.webhookEvent.findFirst({
    where: eq(webhookEvent.id, eventId),
  })

  if (existingEvent?.processingStartedAt && !existingEvent.processedAt) {
    throw new Error("GitHub webhook is already being processed")
  }

  return null
}

export const processGitHubWebhookEvent = async (eventId: string) => {
  const event = await claimGitHubWebhookEvent(eventId)

  if (!event) {
    return
  }

  const payload = event.payload as GitHubWebhookPayload
  const relatedWorkspace =
    ((event.workspaceId
      ? await db.query.workspace.findFirst({
          where: eq(workspace.id, event.workspaceId),
        })
      : null) ??
      (await findWorkspaceByInstallationId(payload.installation?.id))) ??
    null

  try {
    const review = await handleGitHubWebhook({
      event,
      payload,
      relatedWorkspace,
    })
    await finishWebhookEvent(event.id, review)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown webhook processing error"

    await db
      .update(webhookEvent)
      .set({
        processingStartedAt: null,
        processingError: message,
      })
      .where(eq(webhookEvent.id, event.id))

    throw error
  }
}

export type { GitHubWebhookPayload } from "./github"
