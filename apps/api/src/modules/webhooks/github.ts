import { eq } from "drizzle-orm"
import type { WebhookEventDefinition } from "@octokit/webhooks/types"
import { db } from "../../db/client"
import { workspace, type ProviderActor } from "../../db/schema"
import { jobs } from "../../jobs/definitions"
import {
  addPullRequestLifecycleEvent,
  getTrackedPullRequestNumbers,
  getAccessibleRepositoryForWebhook,
  syncGitHubPullRequest,
} from "../pull-requests/service"
import { getPullRequestReviewTrigger } from "../reviews/service"
import { syncGitHubWorkspaceRepositories } from "../workspaces/service"

type GitHubWebhookActor = NonNullable<
  WebhookEventDefinition<"pull-request-opened">["sender"]
>

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
  comment?: {
    id?: number
    in_reply_to_id?: number | null
    body?: string | null
    user?: GitHubWebhookActor
  }
}

export type PullRequestReviewRequest = {
  pullRequestId: string
  headSha: string
  triggerSource: "automatic" | "mention"
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

const toProviderActor = (
  actor: GitHubWebhookActor | null | undefined
): ProviderActor | null =>
  actor
    ? {
        id: String(actor.id),
        login: actor.login,
        avatarUrl: actor.avatar_url ?? null,
        htmlUrl: actor.html_url ?? null,
      }
    : null

const updateWorkspaceConnectionStatus = async (
  installationId: number | undefined,
  action: string | undefined
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

export const handleGitHubWebhook = async ({
  deliveryId,
  eventName,
  payload,
  relatedWorkspace,
}: {
  deliveryId: string
  eventName: string
  payload: GitHubWebhookPayload
  relatedWorkspace: typeof workspace.$inferSelect | null
}): Promise<PullRequestReviewRequest | undefined> => {
  if (eventName === "installation") {
    await updateWorkspaceConnectionStatus(
      payload.installation?.id,
      payload.action
    )

    if (
      relatedWorkspace &&
      (payload.action === "created" || payload.action === "unsuspend")
    ) {
      await syncGitHubWorkspaceRepositories(
        relatedWorkspace.id,
        relatedWorkspace.providerInstallationId,
        payload.installation?.repository_selection
      )
    }
  }

  if (eventName === "installation_repositories" && relatedWorkspace) {
    await syncGitHubWorkspaceRepositories(
      relatedWorkspace.id,
      relatedWorkspace.providerInstallationId,
      payload.installation?.repository_selection
    )
  }

  if (!pullRequestEventNames.has(eventName) || !relatedWorkspace) {
    return
  }

  const number = getTrackedPullRequestNumbers(payload)
  let repo = await getAccessibleRepositoryForWebhook(
    relatedWorkspace.id,
    payload.repository?.id
  )

  if (!repo && number) {
    await syncGitHubWorkspaceRepositories(
      relatedWorkspace.id,
      relatedWorkspace.providerInstallationId,
      payload.installation?.repository_selection
    )
    repo = await getAccessibleRepositoryForWebhook(
      relatedWorkspace.id,
      payload.repository?.id
    )
  }

  if (!repo || !number) {
    return
  }

  const savedPullRequest = await syncGitHubPullRequest(repo, number)

  if (
    eventName === "pull_request" &&
    payload.action &&
    pullRequestLifecycleActions.has(payload.action)
  ) {
    const action =
      payload.action === "closed" && savedPullRequest.state === "merged"
        ? "merged"
        : payload.action

    await addPullRequestLifecycleEvent(
      savedPullRequest.id,
      deliveryId,
      action,
      {
        author: toProviderActor(payload.sender ?? payload.pull_request?.user),
        body: payload.pull_request?.body ?? null,
        htmlUrl: payload.pull_request?.html_url ?? savedPullRequest.htmlUrl,
        providerCreatedAt: payload.pull_request?.updated_at
          ? new Date(payload.pull_request.updated_at)
          : new Date(),
        providerUpdatedAt: payload.pull_request?.updated_at
          ? new Date(payload.pull_request.updated_at)
          : new Date(),
        metadata: {
          state: savedPullRequest.state,
          draft: savedPullRequest.draft,
          baseRef: payload.pull_request?.base?.ref ?? savedPullRequest.baseRef,
          headRef: payload.pull_request?.head?.ref ?? savedPullRequest.headRef,
          headSha: payload.pull_request?.head?.sha ?? savedPullRequest.headSha,
          closedAt: payload.pull_request?.closed_at ?? null,
          mergedAt: payload.pull_request?.merged_at ?? null,
        },
      }
    )
  }

  const triggerSource = repo.enabled
    ? await getPullRequestReviewTrigger({
        eventName,
        action: payload.action,
        pullRequest: savedPullRequest,
        commentBody: payload.comment?.body,
        commentAuthor: payload.sender ?? payload.comment?.user,
      })
    : null
  console.info("Evaluated pull request review trigger", {
    deliveryId,
    eventName,
    action: payload.action ?? null,
    pullRequestId: savedPullRequest.id,
    repositoryId: savedPullRequest.repositoryId,
    headSha: savedPullRequest.headSha,
    triggerSource,
  })

  if (
    eventName === "pull_request_review_comment" &&
    (payload.action === "created" || payload.action === "edited") &&
    payload.comment?.id &&
    payload.comment.in_reply_to_id &&
    repo.enabled
  ) {
    await jobs.distillReviewMemory.enqueue({
      repositoryId: repo.id,
      commentId: payload.comment.id,
    })
  }

  return triggerSource
    ? {
        pullRequestId: savedPullRequest.id,
        headSha: savedPullRequest.headSha,
        triggerSource,
      }
    : undefined
}
