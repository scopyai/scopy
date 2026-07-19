import { eq } from "drizzle-orm"
import { db } from "../../db/client"
import {
  webhookEvent,
  workspace,
  type ProviderActor,
} from "../../db/schema"
import { jobs } from "../../jobs/definitions"
import { listGitHubInstallationRepositories } from "../github/service"
import {
  addPullRequestLifecycleEvent,
  getTrackedPullRequestNumbers,
  getTrackedRepositoryForWebhook,
  syncGitHubPullRequest,
} from "../pull-requests/service"
import { getPullRequestReviewTrigger } from "../reviews/service"
import { syncWorkspaceRepositories } from "../workspaces/service"

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

const syncWebhookRepositories = async (
  relatedWorkspace: typeof workspace.$inferSelect,
  payload: GitHubWebhookPayload,
) => {
  const repositories = await listGitHubInstallationRepositories(
    relatedWorkspace.providerInstallationId,
  )

  await syncWorkspaceRepositories(
    relatedWorkspace.id,
    repositories,
    payload.installation?.repository_selection,
  )
}

export const handleGitHubWebhook = async ({
  event,
  payload,
  relatedWorkspace,
}: {
  event: typeof webhookEvent.$inferSelect
  payload: GitHubWebhookPayload
  relatedWorkspace: typeof workspace.$inferSelect | null
}): Promise<PullRequestReviewRequest | undefined> => {
  if (event.eventName === "installation") {
    await updateWorkspaceConnectionStatus(
      payload.installation?.id,
      payload.action,
    )
  }

  if (event.eventName === "installation_repositories" && relatedWorkspace) {
    await syncWebhookRepositories(relatedWorkspace, payload)
  }

  if (!pullRequestEventNames.has(event.eventName) || !relatedWorkspace) {
    return
  }

  const number = getTrackedPullRequestNumbers(payload)
  let repo = await getTrackedRepositoryForWebhook(
    relatedWorkspace.id,
    payload.repository?.id,
  )

  if (!repo && number) {
    await syncWebhookRepositories(relatedWorkspace, payload)
    repo = await getTrackedRepositoryForWebhook(
      relatedWorkspace.id,
      payload.repository?.id,
    )
  }

  if (!repo || !number) {
    return
  }

  if (
    event.eventName === "pull_request_review_comment" &&
    (payload.action === "created" || payload.action === "edited") &&
    payload.comment?.id &&
    payload.comment.in_reply_to_id
  ) {
    await jobs.distillReviewMemory.enqueue(db, {
      repositoryId: repo.id,
      commentId: payload.comment.id,
    })
  }

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
      },
    )
  }

  const triggerSource = await getPullRequestReviewTrigger({
    eventName: event.eventName,
    action: payload.action,
    pullRequest: savedPullRequest,
    commentBody: payload.comment?.body,
    commentAuthor: payload.sender ?? payload.comment?.user,
  })
  console.info("Evaluated pull request review trigger", {
    webhookEventId: event.id,
    eventName: event.eventName,
    action: payload.action ?? null,
    pullRequestId: savedPullRequest.id,
    repositoryId: savedPullRequest.repositoryId,
    headSha: savedPullRequest.headSha,
    triggerSource,
  })

  return triggerSource
    ? {
        pullRequestId: savedPullRequest.id,
        headSha: savedPullRequest.headSha,
        triggerSource,
      }
    : undefined
}
