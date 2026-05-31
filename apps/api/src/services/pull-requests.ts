import { randomUUID } from "node:crypto"
import {
  and,
  eq,
  isNull,
  notInArray,
} from "drizzle-orm"
import { db } from "../db/client"
import {
  pullRequest,
  pullRequestTimelineEvent,
  repository,
  type ProviderActor,
} from "../db/schema"
import { createGitHubApp } from "./github"

type GitHubActor = {
  id: number
  login: string
  avatar_url?: string | null
  html_url?: string | null
}

type GitHubPullRequest = {
  id: number
  number: number
  title: string
  body: string | null
  html_url: string
  user: GitHubActor | null
  state: "open" | "closed"
  draft?: boolean | null
  base: { ref: string }
  head: { ref: string; sha: string }
  labels: Array<{ name?: string | null }>
  assignees?: GitHubActor[] | null
  created_at: string
  updated_at: string
  closed_at: string | null
  merged_at: string | null
}

type GitHubIssueComment = {
  id: number
  user: GitHubActor | null
  body?: string | null
  html_url: string
  created_at: string
  updated_at: string
}

type GitHubReview = {
  id: number
  user: GitHubActor | null
  body?: string | null
  html_url: string
  state: string
  commit_id?: string | null
  submitted_at?: string | null
}

type GitHubReviewComment = GitHubIssueComment & {
  path: string
  diff_hunk: string
  line?: number | null
  original_line?: number | null
  side?: string | null
  start_line?: number | null
  original_start_line?: number | null
  start_side?: string | null
  in_reply_to_id?: number
}

type TimelineEventType = "issue_comment" | "review" | "review_comment"

const toDate = (value: string) => new Date(value)
const toNullableDate = (value: string | null | undefined) =>
  value ? new Date(value) : null

const toActor = (actor: GitHubActor | null | undefined): ProviderActor | null =>
  actor
    ? {
        id: String(actor.id),
        login: actor.login,
        avatarUrl: actor.avatar_url ?? null,
        htmlUrl: actor.html_url ?? null,
      }
    : null

const getInstallationOctokit = async (installationId: string) => {
  const app = createGitHubApp()
  return app.getInstallationOctokit(Number(installationId))
}

const upsertTimelineEvent = async ({
  pullRequestId,
  eventType,
  externalKey,
  action,
  author,
  body,
  metadata,
  htmlUrl,
  providerCreatedAt,
  providerUpdatedAt,
}: {
  pullRequestId: string
  eventType: TimelineEventType | "lifecycle"
  externalKey: string
  action?: string | null
  author?: ProviderActor | null
  body?: string | null
  metadata?: Record<string, unknown>
  htmlUrl?: string | null
  providerCreatedAt: Date
  providerUpdatedAt: Date
}) => {
  const values = {
    id: randomUUID(),
    pullRequestId,
    eventType,
    externalKey,
    action: action ?? null,
    author: author ?? null,
    body: body ?? null,
    metadata: metadata ?? {},
    htmlUrl: htmlUrl ?? null,
    providerCreatedAt,
    providerUpdatedAt,
    deletedAt: null,
    updatedAt: new Date(),
  }

  await db
    .insert(pullRequestTimelineEvent)
    .values(values)
    .onConflictDoUpdate({
      target: [
        pullRequestTimelineEvent.pullRequestId,
        pullRequestTimelineEvent.externalKey,
      ],
      set: {
        action: values.action,
        author: values.author,
        body: values.body,
        metadata: values.metadata,
        htmlUrl: values.htmlUrl,
        providerCreatedAt: values.providerCreatedAt,
        providerUpdatedAt: values.providerUpdatedAt,
        deletedAt: null,
        updatedAt: values.updatedAt,
      },
    })
}

const markMissingTimelineEventsDeleted = async (
  pullRequestId: string,
  eventType: TimelineEventType,
  externalKeys: string[],
) => {
  const where = [
    eq(pullRequestTimelineEvent.pullRequestId, pullRequestId),
    eq(pullRequestTimelineEvent.eventType, eventType),
    isNull(pullRequestTimelineEvent.deletedAt),
  ]

  if (externalKeys.length > 0) {
    where.push(notInArray(pullRequestTimelineEvent.externalKey, externalKeys))
  }

  await db
    .update(pullRequestTimelineEvent)
    .set({
      deletedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(...where))
}

const syncIssueComments = async (
  pullRequestId: string,
  comments: GitHubIssueComment[],
) => {
  const externalKeys = comments.map((comment) => `issue-comment:${comment.id}`)

  for (const comment of comments) {
    await upsertTimelineEvent({
      pullRequestId,
      eventType: "issue_comment",
      externalKey: `issue-comment:${comment.id}`,
      author: toActor(comment.user),
      body: comment.body ?? null,
      htmlUrl: comment.html_url,
      providerCreatedAt: toDate(comment.created_at),
      providerUpdatedAt: toDate(comment.updated_at),
    })
  }

  await markMissingTimelineEventsDeleted(
    pullRequestId,
    "issue_comment",
    externalKeys,
  )
}

const syncReviews = async (pullRequestId: string, reviews: GitHubReview[]) => {
  const externalKeys = reviews.map((review) => `review:${review.id}`)

  for (const review of reviews) {
    const submittedAt = toNullableDate(review.submitted_at) ?? new Date()

    await upsertTimelineEvent({
      pullRequestId,
      eventType: "review",
      externalKey: `review:${review.id}`,
      action: review.state.toLowerCase(),
      author: toActor(review.user),
      body: review.body ?? null,
      htmlUrl: review.html_url,
      metadata: {
        state: review.state.toLowerCase(),
        commitId: review.commit_id ?? null,
      },
      providerCreatedAt: submittedAt,
      providerUpdatedAt: submittedAt,
    })
  }

  await markMissingTimelineEventsDeleted(pullRequestId, "review", externalKeys)
}

const syncReviewComments = async (
  pullRequestId: string,
  comments: GitHubReviewComment[],
) => {
  const externalKeys = comments.map((comment) => `review-comment:${comment.id}`)

  for (const comment of comments) {
    await upsertTimelineEvent({
      pullRequestId,
      eventType: "review_comment",
      externalKey: `review-comment:${comment.id}`,
      author: toActor(comment.user),
      body: comment.body ?? null,
      htmlUrl: comment.html_url,
      metadata: {
        path: comment.path,
        diffHunk: comment.diff_hunk,
        line: comment.line ?? null,
        originalLine: comment.original_line ?? null,
        side: comment.side ?? null,
        startLine: comment.start_line ?? null,
        originalStartLine: comment.original_start_line ?? null,
        startSide: comment.start_side ?? null,
        inReplyToId: comment.in_reply_to_id ?? null,
      },
      providerCreatedAt: toDate(comment.created_at),
      providerUpdatedAt: toDate(comment.updated_at),
    })
  }

  await markMissingTimelineEventsDeleted(
    pullRequestId,
    "review_comment",
    externalKeys,
  )
}

export const syncGitHubPullRequest = async (
  repo: typeof repository.$inferSelect,
  number: number,
) => {
  const workspace = await db.query.workspace.findFirst({
    where: (workspace, { eq }) => eq(workspace.id, repo.workspaceId),
  })

  if (!workspace) {
    throw new Error("Workspace not found for repository")
  }

  const octokit = await getInstallationOctokit(workspace.providerInstallationId)
  const [pullResponse, issueComments, reviews, reviewComments] =
    await Promise.all([
      octokit.request("GET /repos/{owner}/{repo}/pulls/{pull_number}", {
        owner: repo.owner,
        repo: repo.name,
        pull_number: number,
      }),
      octokit.paginate("GET /repos/{owner}/{repo}/issues/{issue_number}/comments", {
        owner: repo.owner,
        repo: repo.name,
        issue_number: number,
        per_page: 100,
      }),
      octokit.paginate("GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews", {
        owner: repo.owner,
        repo: repo.name,
        pull_number: number,
        per_page: 100,
      }),
      octokit.paginate("GET /repos/{owner}/{repo}/pulls/{pull_number}/comments", {
        owner: repo.owner,
        repo: repo.name,
        pull_number: number,
        per_page: 100,
      }),
    ])
  const githubPullRequest = pullResponse.data as GitHubPullRequest
  const now = new Date()
  const state = githubPullRequest.merged_at
    ? ("merged" as const)
    : githubPullRequest.state
  const values = {
    id: randomUUID(),
    repositoryId: repo.id,
    providerPullRequestId: String(githubPullRequest.id),
    number: githubPullRequest.number,
    title: githubPullRequest.title,
    body: githubPullRequest.body,
    htmlUrl: githubPullRequest.html_url,
    author: toActor(githubPullRequest.user),
    state,
    draft: githubPullRequest.draft ?? false,
    baseRef: githubPullRequest.base.ref,
    headRef: githubPullRequest.head.ref,
    headSha: githubPullRequest.head.sha,
    labels: githubPullRequest.labels.flatMap((label) =>
      label.name ? [label.name] : [],
    ),
    assignees: (githubPullRequest.assignees ?? []).flatMap((actor) => {
      const assignee = toActor(actor)
      return assignee ? [assignee] : []
    }),
    openedAt: toDate(githubPullRequest.created_at),
    closedAt: toNullableDate(githubPullRequest.closed_at),
    mergedAt: toNullableDate(githubPullRequest.merged_at),
    providerCreatedAt: toDate(githubPullRequest.created_at),
    providerUpdatedAt: toDate(githubPullRequest.updated_at),
    lastSyncedAt: now,
    updatedAt: now,
  }

  const [savedPullRequest] = await db
    .insert(pullRequest)
    .values(values)
    .onConflictDoUpdate({
      target: [pullRequest.repositoryId, pullRequest.providerPullRequestId],
      set: {
        number: values.number,
        title: values.title,
        body: values.body,
        htmlUrl: values.htmlUrl,
        author: values.author,
        state: values.state,
        draft: values.draft,
        baseRef: values.baseRef,
        headRef: values.headRef,
        headSha: values.headSha,
        labels: values.labels,
        assignees: values.assignees,
        openedAt: values.openedAt,
        closedAt: values.closedAt,
        mergedAt: values.mergedAt,
        providerCreatedAt: values.providerCreatedAt,
        providerUpdatedAt: values.providerUpdatedAt,
        lastSyncedAt: values.lastSyncedAt,
        updatedAt: values.updatedAt,
      },
    })
    .returning()

  await Promise.all([
    upsertTimelineEvent({
      pullRequestId: savedPullRequest.id,
      eventType: "lifecycle",
      externalKey: "lifecycle:initialized",
      action: "opened",
      author: values.author,
      metadata: {
        source: "initial_sync",
      },
      htmlUrl: values.htmlUrl,
      providerCreatedAt: values.providerCreatedAt,
      providerUpdatedAt: values.providerCreatedAt,
    }),
    syncIssueComments(
      savedPullRequest.id,
      issueComments as GitHubIssueComment[],
    ),
    syncReviews(savedPullRequest.id, reviews as GitHubReview[]),
    syncReviewComments(
      savedPullRequest.id,
      reviewComments as GitHubReviewComment[],
    ),
  ])

  return savedPullRequest
}

export const syncRepositoryPullRequests = async (
  repo: typeof repository.$inferSelect,
) => {
  if (repo.providerAccessRemovedAt) {
    throw new Error("Repository is no longer accessible through the GitHub App")
  }

  const workspace = await db.query.workspace.findFirst({
    where: (workspace, { eq }) => eq(workspace.id, repo.workspaceId),
  })

  if (!workspace) {
    throw new Error("Workspace not found for repository")
  }

  const octokit = await getInstallationOctokit(workspace.providerInstallationId)
  const [openPullRequests, knownPullRequests] = await Promise.all([
    octokit.paginate("GET /repos/{owner}/{repo}/pulls", {
      owner: repo.owner,
      repo: repo.name,
      state: "open",
      per_page: 100,
    }),
    db
      .select({ number: pullRequest.number })
      .from(pullRequest)
      .where(eq(pullRequest.repositoryId, repo.id)),
  ])
  const numbers = new Set<number>([
    ...(openPullRequests as GitHubPullRequest[]).map((item) => item.number),
    ...knownPullRequests.map((item) => item.number),
  ])

  for (const number of numbers) {
    await syncGitHubPullRequest(repo, number)
  }

  return {
    synced: numbers.size,
  }
}

export const addPullRequestLifecycleEvent = async (
  pullRequestId: string,
  deliveryId: string,
  action: string,
  createdAt: Date,
) =>
  upsertTimelineEvent({
    pullRequestId,
    eventType: "lifecycle",
    externalKey: `lifecycle:webhook:${deliveryId}`,
    action,
    metadata: {
      source: "webhook",
    },
    providerCreatedAt: createdAt,
    providerUpdatedAt: createdAt,
  })

export const getTrackedRepositoryForWebhook = async (
  workspaceId: string,
  providerRepositoryId: number | undefined,
) => {
  if (!providerRepositoryId) {
    return null
  }

  return db.query.repository.findFirst({
    where: and(
      eq(repository.workspaceId, workspaceId),
      eq(repository.providerRepositoryId, String(providerRepositoryId)),
      eq(repository.enabled, true),
      isNull(repository.providerAccessRemovedAt),
    ),
  })
}

export const getTrackedPullRequestNumbers = (payload: {
  pull_request?: { number?: number }
  issue?: { number?: number; pull_request?: unknown }
}) => {
  if (payload.pull_request?.number) {
    return payload.pull_request.number
  }

  if (payload.issue?.pull_request && payload.issue.number) {
    return payload.issue.number
  }

  return null
}
