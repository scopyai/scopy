import type { repository } from "../../db/schema"
import { createGitHubApp } from "../github/service"
import type { PullRequestFile } from "./diff"
import type { ReviewFinding } from "./prompt"

type Repository = typeof repository.$inferSelect
type PullRequestReviewComment = {
  path: string
  body: string
  line: number
  side: "RIGHT"
  start_line?: number
  start_side?: "RIGHT"
}
export type PullRequestReviewEvent = "COMMENT" | "REQUEST_CHANGES"

const getOctokit = async (installationId: string) =>
  createGitHubApp().getInstallationOctokit(Number(installationId))

const getMarker = (pullRequestId: string) =>
  `<!-- reviewbot:summary:${encodeURIComponent(pullRequestId)} -->`

const withMarker = (body: string, pullRequestId: string) =>
  `${body}\n\n${getMarker(pullRequestId)}`

export const reviewStartedBody =
  "Review started. I am analyzing the changes in this pull request."

export const reviewFailedBody =
  "I could not complete this review after several retries. Please mention me again later to retry."

export const reviewBalanceBlockedBody =
  "I cannot start this review because this workspace has no remaining usage balance. Please update billing or wait for the next allowance reset."

const severityLabel = (severity: ReviewFinding["severity"]) =>
  severity.toUpperCase()

export const renderInlineReviewComment = (finding: ReviewFinding) =>
  [
    `**[${severityLabel(finding.severity)}] ${finding.title}**`,
    "",
    finding.body,
    "",
    `Confidence: ${Math.round(finding.confidence * 100)}%`,
  ].join("\n")

export const buildPullRequestReviewComments = (
  findings: ReviewFinding[],
): PullRequestReviewComment[] =>
  findings.map((finding) => ({
    path: finding.file,
    body: renderInlineReviewComment(finding),
    line: finding.endLine,
    side: "RIGHT",
    ...(finding.startLine !== finding.endLine
      ? {
          start_line: finding.startLine,
          start_side: "RIGHT" as const,
        }
      : {}),
  }))

export const publishPullRequestReview = async ({
  repo,
  installationId,
  pullRequestNumber,
  headSha,
  findings,
  event = "COMMENT",
}: {
  repo: Repository
  installationId: string
  pullRequestNumber: number
  headSha: string
  findings: ReviewFinding[]
  event?: PullRequestReviewEvent
}) => {
  if (findings.length === 0) {
    return null
  }

  const octokit = await getOctokit(installationId)
  const comments = buildPullRequestReviewComments(findings)
  const review = await octokit.request(
    "POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews",
    {
      owner: repo.owner,
      repo: repo.name,
      pull_number: pullRequestNumber,
      commit_id: headSha,
      comments,
    },
  )

  await octokit.request(
    "POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}/events",
    {
      owner: repo.owner,
      repo: repo.name,
      pull_number: pullRequestNumber,
      review_id: review.data.id,
      event,
      body: "",
    },
  )

  return {
    reviewId: review.data.id,
    inlineCommentCount: comments.length,
    event,
  }
}

export const findOrCreateReviewComment = async ({
  repo,
  installationId,
  pullRequestNumber,
  pullRequestId,
}: {
  repo: Repository
  installationId: string
  pullRequestNumber: number
  pullRequestId: string
}) => {
  const octokit = await getOctokit(installationId)
  const marker = getMarker(pullRequestId)
  const comments = await octokit.paginate(
    "GET /repos/{owner}/{repo}/issues/{issue_number}/comments",
    {
      owner: repo.owner,
      repo: repo.name,
      issue_number: pullRequestNumber,
      per_page: 100,
    },
  )
  const existing = comments.find(
    (comment) =>
      typeof comment.body === "string" && comment.body.includes(marker),
  )

  if (existing) {
    await updateReviewComment({
      repo,
      installationId,
      commentId: existing.id,
      pullRequestId,
      body: reviewStartedBody,
    })
    return existing.id
  }

  const response = await octokit.request(
    "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
    {
      owner: repo.owner,
      repo: repo.name,
      issue_number: pullRequestNumber,
      body: withMarker(reviewStartedBody, pullRequestId),
    },
  )

  return response.data.id
}

export const updateReviewComment = async ({
  repo,
  installationId,
  commentId,
  pullRequestId,
  body,
}: {
  repo: Repository
  installationId: string
  commentId: number
  pullRequestId: string
  body: string
}) => {
  const octokit = await getOctokit(installationId)
  await octokit.request(
    "PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}",
    {
      owner: repo.owner,
      repo: repo.name,
      comment_id: commentId,
      body: withMarker(body, pullRequestId),
    },
  )
}

export const listPullRequestFiles = async ({
  repo,
  installationId,
  pullRequestNumber,
}: {
  repo: Repository
  installationId: string
  pullRequestNumber: number
}) => {
  const octokit = await getOctokit(installationId)
  const files = await octokit.paginate(
    "GET /repos/{owner}/{repo}/pulls/{pull_number}/files",
    {
      owner: repo.owner,
      repo: repo.name,
      pull_number: pullRequestNumber,
      per_page: 100,
    },
  )

  return files.map(
    (file): PullRequestFile => ({
      filename: file.filename,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      changes: file.changes,
      patch: file.patch,
    }),
  )
}
