import { randomUUID } from "node:crypto"
import { eq } from "drizzle-orm"
import { db } from "../db/client"
import {
  reviewConfig,
  reviewRun,
  webhookEvent,
  workspace,
  type ProviderActor,
} from "../db/schema"
import {
  createGitHubWebhooks,
  listGitHubInstallationRepositories,
} from "./github"
import { enqueueJob, type JobExecutor } from "./jobs"
import {
  addPullRequestLifecycleEvent,
  getTrackedPullRequestNumbers,
  getTrackedRepositoryForWebhook,
  syncGitHubPullRequest,
} from "./pull-requests"
import { syncWorkspaceRepositories } from "./workspaces"

type GitHubWebhookActor = {
  id: number
  login: string
  avatar_url?: string | null
  html_url?: string | null
}

export type GitHubWebhookPayload = {
  action?: string
  installation?: {
    id: number
    repository_selection?: "all" | "selected"
  }
  repository?: {
    id?: number
  }
  pull_request?: {
    number?: number
    body?: string | null
    html_url?: string
    state?: "open" | "closed"
    draft?: boolean
    merged?: boolean
    merged_at?: string | null
    closed_at?: string | null
    updated_at?: string
    created_at?: string
    base?: {
      ref?: string
    }
    head?: {
      ref?: string
      sha?: string
    }
    user?: GitHubWebhookActor
  }
  sender?: GitHubWebhookActor
  issue?: {
    number?: number
    pull_request?: unknown
  }
}

const pullRequestEventNames = new Set([
  "pull_request",
  "issue_comment",
  "pull_request_review",
  "pull_request_review_comment",
  "pull_request_review_thread",
])

const pullRequestLifecycleActions = new Set([
  "opened",
  "closed",
  "reopened",
  "ready_for_review",
  "converted_to_draft",
])

const pullRequestReviewActions = new Set([
  "opened",
  "ready_for_review",
  "synchronize",
])

const toProviderActor = (
  actor: GitHubWebhookActor | null | undefined,
): ProviderActor | null =>
  actor
    ? {
        id: String(actor.id),
        login: actor.login,
        avatarUrl: actor.avatar_url ?? null,
        htmlUrl: actor.html_url ?? null,
      }
    : null

const findWorkspaceByInstallationId = async (installationId?: number) => {
  if (!installationId) {
    return null
  }

  return db.query.workspace.findFirst({
    where: eq(workspace.providerInstallationId, String(installationId)),
  })
}

const updateWorkspaceConnectionStatus = async (
  installationId: number | undefined,
  action: string | undefined,
) => {
  if (!installationId) {
    return
  }

  const connectionStatus =
    action === "deleted"
      ? "deleted"
      : action === "suspend"
        ? "suspended"
        : action === "unsuspend" || action === "created"
          ? "active"
          : null

  if (!connectionStatus) {
    return
  }

  await db
    .update(workspace)
    .set({
      connectionStatus,
      updatedAt: new Date(),
    })
    .where(eq(workspace.providerInstallationId, String(installationId)))
}

const matchesBranchPattern = (branch: string, pattern: string) => {
  const expression = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")

  return new RegExp(`^${expression}$`).test(branch)
}

const shouldReviewPullRequest = async (
  eventName: string,
  action: string | undefined,
  savedPullRequest: Awaited<ReturnType<typeof syncGitHubPullRequest>>,
) => {
  if (
    eventName !== "pull_request" ||
    !action ||
    !pullRequestReviewActions.has(action)
  ) {
    return false
  }

  const config = await db.query.reviewConfig.findFirst({
    where: eq(reviewConfig.repositoryId, savedPullRequest.repositoryId),
  })

  return Boolean(
    config?.enabled &&
      config.reviewPullRequests &&
      (config.reviewDrafts || !savedPullRequest.draft) &&
      config.baseBranchPatterns.some((pattern) =>
        matchesBranchPattern(savedPullRequest.baseRef, pattern),
      ),
  )
}

const finishWebhookEvent = async (
  eventId: string,
  review?: {
    pullRequestId: string
    headSha: string
  },
) => {
  await db.transaction(async (tx) => {
    if (review) {
      const [run] = await tx
        .insert(reviewRun)
        .values({
          id: randomUUID(),
          pullRequestId: review.pullRequestId,
          triggerWebhookEventId: eventId,
          headSha: review.headSha,
        })
        .onConflictDoNothing({
          target: [reviewRun.pullRequestId, reviewRun.headSha],
        })
        .returning()

      if (run) {
        await enqueueJob(
          tx,
          "review_pull_request",
          { reviewRunId: run.id },
        )
      }
    }

    await tx
      .update(webhookEvent)
      .set({
        processedAt: new Date(),
        processingError: null,
      })
      .where(eq(webhookEvent.id, eventId))
  })
}

export const enqueueGitHubWebhookEvent = async (
  eventId: string,
  executor: JobExecutor = db,
) => {
  await enqueueJob(
    executor,
    "process_github_webhook",
    { webhookEventId: eventId },
  )
}

export const processGitHubWebhookEvent = async (eventId: string) => {
  const event = await db.query.webhookEvent.findFirst({
    where: eq(webhookEvent.id, eventId),
  })

  if (!event || event.processedAt) {
    return
  }

  const payload = event.payload as GitHubWebhookPayload
  const relatedWorkspace =
    (event.workspaceId
      ? await db.query.workspace.findFirst({
          where: eq(workspace.id, event.workspaceId),
        })
      : null) ??
    (await findWorkspaceByInstallationId(payload.installation?.id))

  try {
    if (event.eventName === "installation") {
      await updateWorkspaceConnectionStatus(
        payload.installation?.id,
        payload.action,
      )
    }

    if (event.eventName === "installation_repositories" && relatedWorkspace) {
      const repositories = await listGitHubInstallationRepositories(
        relatedWorkspace.providerInstallationId,
      )

      await syncWorkspaceRepositories(
        relatedWorkspace.id,
        repositories,
        payload.installation?.repository_selection,
      )
    }

    if (pullRequestEventNames.has(event.eventName) && relatedWorkspace) {
      const repo = await getTrackedRepositoryForWebhook(
        relatedWorkspace.id,
        payload.repository?.id,
      )
      const number = getTrackedPullRequestNumbers(payload)

      if (repo && number) {
        const savedPullRequest = await syncGitHubPullRequest(repo, number)

        if (
          event.eventName === "pull_request" &&
          payload.action &&
          pullRequestLifecycleActions.has(payload.action)
        ) {
          const action =
            payload.action === "closed" && savedPullRequest.state === "merged"
              ? "merged"
              : payload.action

          await addPullRequestLifecycleEvent(
            savedPullRequest.id,
            event.deliveryId,
            action,
            {
              author: toProviderActor(
                payload.sender ?? payload.pull_request?.user,
              ),
              body: payload.pull_request?.body ?? null,
              htmlUrl:
                payload.pull_request?.html_url ?? savedPullRequest.htmlUrl,
              providerCreatedAt: payload.pull_request?.updated_at
                ? new Date(payload.pull_request.updated_at)
                : new Date(),
              providerUpdatedAt: payload.pull_request?.updated_at
                ? new Date(payload.pull_request.updated_at)
                : new Date(),
              metadata: {
                state: savedPullRequest.state,
                draft: savedPullRequest.draft,
                baseRef:
                  payload.pull_request?.base?.ref ?? savedPullRequest.baseRef,
                headRef:
                  payload.pull_request?.head?.ref ?? savedPullRequest.headRef,
                headSha:
                  payload.pull_request?.head?.sha ?? savedPullRequest.headSha,
                closedAt: payload.pull_request?.closed_at ?? null,
                mergedAt: payload.pull_request?.merged_at ?? null,
              },
            },
          )
        }

        const shouldReview = await shouldReviewPullRequest(
          event.eventName,
          payload.action,
          savedPullRequest,
        )

        await finishWebhookEvent(
          event.id,
          shouldReview
            ? {
                pullRequestId: savedPullRequest.id,
                headSha: savedPullRequest.headSha,
              }
            : undefined,
        )
        return
      }
    }

    await finishWebhookEvent(event.id)
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown webhook processing error"

    await db
      .update(webhookEvent)
      .set({
        processingError: message,
      })
      .where(eq(webhookEvent.id, event.id))

    throw error
  }
}

export const verifyGitHubWebhook = async (
  payloadText: string,
  signature: string,
) => {
  const webhooks = createGitHubWebhooks()
  return webhooks.verify(payloadText, signature)
}
