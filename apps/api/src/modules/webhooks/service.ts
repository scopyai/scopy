import { randomUUID } from "node:crypto"
import { and, eq, isNull } from "drizzle-orm"
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
  review?: PullRequestReviewRequest
) => {
  if (review) {
    const reviewRunId = await db.transaction((tx) =>
      schedulePullRequestReview(tx, {
        webhookEventId: eventId,
        ...review,
      })
    )
    await jobs.reviewPullRequest.enqueue({ reviewRunId })
  }

  await db
    .update(webhookEvent)
    .set({
      processedAt: new Date(),
    })
    .where(eq(webhookEvent.id, eventId))
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
    payload.installation?.id
  )

  const event = await db.transaction(async (tx) => {
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

    return (
      savedWebhookEvent ??
      (await tx.query.webhookEvent.findFirst({
        where: and(
          eq(webhookEvent.provider, "github"),
          eq(webhookEvent.deliveryId, deliveryId)
        ),
      }))
    )
  })

  if (event && !event.processedAt) {
    await jobs.processGitHubWebhook.enqueue({
      webhookEventId: event.id,
    })
  }
}

export const processGitHubWebhookEvent = async (eventId: string) => {
  const event = await db.query.webhookEvent.findFirst({
    where: and(eq(webhookEvent.id, eventId), isNull(webhookEvent.processedAt)),
  })

  if (!event) {
    return
  }

  const payload = event.payload as GitHubWebhookPayload
  const relatedWorkspace =
    (event.workspaceId
      ? await db.query.workspace.findFirst({
          where: eq(workspace.id, event.workspaceId),
        })
      : null) ??
    (await findWorkspaceByInstallationId(payload.installation?.id)) ??
    null

  const review = await handleGitHubWebhook({
    event,
    payload,
    relatedWorkspace,
  })
  await finishWebhookEvent(event.id, review)
}

export type { GitHubWebhookPayload } from "./github"
