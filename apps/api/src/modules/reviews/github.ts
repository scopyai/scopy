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

export const REVIEW_CHECK_NAME = "AI Review"

export type ReviewCheckConclusion =
  | "success"
  | "neutral"
  | "action_required"
  | "failure"

export type ReviewCheckOutput = {
  title: string
  summary: string
}

const getOctokit = async (installationId: string) =>
  createGitHubApp().getInstallationOctokit(Number(installationId))

export const startReviewCheck = async ({
  repo,
  installationId,
  reviewRunId,
  headSha,
  checkRunId,
  detailsUrl,
}: {
  repo: Repository
  installationId: string
  reviewRunId: string
  headSha: string
  checkRunId?: string | null
  detailsUrl: string
}) => {
  const octokit = await getOctokit(installationId)
  let existingCheckRunId = checkRunId

  if (!existingCheckRunId) {
    const response = await octokit.request(
      "GET /repos/{owner}/{repo}/commits/{ref}/check-runs",
      {
        owner: repo.owner,
        repo: repo.name,
        ref: headSha,
        check_name: REVIEW_CHECK_NAME,
        per_page: 100,
      },
    )
    existingCheckRunId = response.data.check_runs.find(
      (checkRun) => checkRun.external_id === reviewRunId,
    )?.id.toString()
  }

  if (existingCheckRunId) {
    await octokit.request(
      "PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}",
      {
        owner: repo.owner,
        repo: repo.name,
        check_run_id: Number(existingCheckRunId),
        status: "in_progress",
        started_at: new Date().toISOString(),
        details_url: detailsUrl,
        output: {
          title: "Review in progress",
          summary: "Analyzing the changes in this pull request.",
        },
      },
    )
    return existingCheckRunId
  }

  const response = await octokit.request(
    "POST /repos/{owner}/{repo}/check-runs",
    {
      owner: repo.owner,
      repo: repo.name,
      name: REVIEW_CHECK_NAME,
      head_sha: headSha,
      status: "in_progress",
      started_at: new Date().toISOString(),
      external_id: reviewRunId,
      details_url: detailsUrl,
      output: {
        title: "Review in progress",
        summary: "Analyzing the changes in this pull request.",
      },
    },
  )

  return response.data.id.toString()
}

export const completeReviewCheck = async ({
  repo,
  installationId,
  checkRunId,
  conclusion,
  output,
  detailsUrl,
}: {
  repo: Repository
  installationId: string
  checkRunId: string
  conclusion: ReviewCheckConclusion
  output: ReviewCheckOutput
  detailsUrl: string
}) => {
  const octokit = await getOctokit(installationId)
  await octokit.request(
    "PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}",
    {
      owner: repo.owner,
      repo: repo.name,
      check_run_id: Number(checkRunId),
      status: "completed",
      conclusion,
      completed_at: new Date().toISOString(),
      details_url: detailsUrl,
      output,
    },
  )
}

export const buildCompletedReviewCheckOutput = ({
  durationMs,
  reviewedFileCount,
  findings = [],
  partialPublication = false,
}: {
  durationMs?: number
  reviewedFileCount?: number
  findings?: Array<{ severity: ReviewFinding["severity"] }>
  partialPublication?: boolean
}): ReviewCheckOutput => {
  const counts = { critical: 0, high: 0, medium: 0, low: 0 }
  for (const finding of findings) {
    counts[finding.severity] += 1
  }

  const duration =
    typeof durationMs === "number"
      ? `${Math.max(1, Math.round(durationMs / 1000))}s`
      : "unknown"
  const files = reviewedFileCount ?? 0
  const findingSummary = [
    `${findings.length} total`,
    `${counts.critical} critical`,
    `${counts.high} high`,
    `${counts.medium} medium`,
    `${counts.low} low`,
  ].join(", ")

  return {
    title: partialPublication
      ? "Review completed with a publishing warning"
      : "Review completed",
    summary: [
      `Reviewed ${files} file${files === 1 ? "" : "s"} in ${duration}.`,
      `Findings: ${findingSummary}.`,
      partialPublication
        ? "Some inline comments could not be published. See the pull request summary for details."
        : "See the pull request summary and inline comments for details.",
    ].join("\n\n"),
  }
}

export type ReviewCommentScope = {
  pullRequestId: string
  reviewRunId?: string
}

export const getReviewCommentMarker = ({
  pullRequestId,
  reviewRunId,
}: ReviewCommentScope) =>
  reviewRunId
    ? `<!-- reviewbot:summary:${encodeURIComponent(pullRequestId)}:${encodeURIComponent(reviewRunId)} -->`
    : `<!-- reviewbot:summary:${encodeURIComponent(pullRequestId)} -->`

const withMarker = (body: string, scope: ReviewCommentScope) =>
  `${body}\n\n${getReviewCommentMarker(scope)}`

export const reviewStartedBody =
  "Review started. I am analyzing the changes in this pull request."

export const reviewFailedBody =
  "I could not complete this review after several retries. Please mention me again later to retry."

export const reviewBalanceBlockedBody =
  "I cannot start this review because this workspace has no remaining usage balance. Please update billing or wait for the next allowance reset."

const severityLabel = (severity: ReviewFinding["severity"]) =>
  severity.toUpperCase()

const renderFixPrompt = (finding: ReviewFinding) => {
  const prompt = [
    "Fix the following issue found in this pull request.",
    "",
    `Title: ${finding.title}`,
    `File: ${finding.file}`,
    `Lines: ${finding.startLine}-${finding.endLine}`,
    `Severity: ${finding.severity}`,
    "",
    "Description:",
    finding.body,
  ].join("\n")
  const longestFence = Math.max(
    0,
    ...(prompt.match(/`+/g) ?? []).map((match) => match.length),
  )
  const fence = "`".repeat(Math.max(3, longestFence + 1))

  return [
    "<details>",
    "<summary>Fix with AI</summary>",
    "",
    `${fence}text`,
    prompt,
    fence,
    "",
    "</details>",
  ].join("\n")
}

export const renderInlineReviewComment = (finding: ReviewFinding) =>
  [
    `**[${severityLabel(finding.severity)}] ${finding.title}**`,
    "",
    finding.body,
    "",
    `Confidence: ${Math.round(finding.confidence * 100)}%`,
    "",
    renderFixPrompt(finding),
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
  reviewRunId,
}: {
  repo: Repository
  installationId: string
  pullRequestNumber: number
  pullRequestId: string
  reviewRunId?: string
}) => {
  const octokit = await getOctokit(installationId)
  const scope = { pullRequestId, reviewRunId }
  const marker = getReviewCommentMarker(scope)
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
      reviewRunId,
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
      body: withMarker(reviewStartedBody, scope),
    },
  )

  return response.data.id
}

export const updateReviewComment = async ({
  repo,
  installationId,
  commentId,
  pullRequestId,
  reviewRunId,
  body,
}: {
  repo: Repository
  installationId: string
  commentId: number
  pullRequestId: string
  reviewRunId?: string
  body: string
}) => {
  const octokit = await getOctokit(installationId)
  await octokit.request(
    "PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}",
    {
      owner: repo.owner,
      repo: repo.name,
      comment_id: commentId,
      body: withMarker(body, { pullRequestId, reviewRunId }),
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
