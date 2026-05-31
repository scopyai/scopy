import type { repository } from "../db/schema"
import { createGitHubApp } from "../services/github"
import type { PullRequestFile } from "./diff"

type Repository = typeof repository.$inferSelect

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
