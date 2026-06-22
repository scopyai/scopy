import { randomUUID } from "node:crypto"
import { and, eq } from "drizzle-orm"
import { db } from "../../db/client"
import { pullRequest, reviewRun } from "../../db/schema"
import { env } from "../../env"
import { jobs } from "../../jobs/definitions"
import { containsBotMention, isBotAuthoredComment } from "./triggers"
import { resolveReviewConfig, selectReviewTrigger } from "./review-config"

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
type TriggerSource = "automatic" | "mention"

const automaticReviewActions = new Set(["opened", "ready_for_review"])

export const getPullRequestReviewTrigger = async ({
  eventName,
  action,
  pullRequest: savedPullRequest,
  commentBody,
  commentAuthor,
}: {
  eventName: string
  action?: string
  pullRequest: typeof pullRequest.$inferSelect
  commentBody?: string | null
  commentAuthor?: { login?: string; type?: string } | null
}): Promise<TriggerSource | null> => {
  const appSlug = env.GITHUB_APP_SLUG
  const isAutomatic =
    eventName === "pull_request" &&
    Boolean(action && automaticReviewActions.has(action))
  const isMention =
    eventName === "issue_comment" &&
    action === "created" &&
    Boolean(
      appSlug &&
      commentBody &&
      containsBotMention(commentBody, appSlug) &&
      !isBotAuthoredComment(commentAuthor, appSlug)
    )

  if (!isAutomatic && !isMention) {
    return null
  }

  const repo = await db.query.repository.findFirst({
    where: (repository, { eq }) =>
      eq(repository.id, savedPullRequest.repositoryId),
    with: {
      workspace: true,
    },
  })

  if (!repo) {
    return null
  }

  const config = resolveReviewConfig(repo.workspace, repo)

  return selectReviewTrigger({
    isAutomatic,
    isMention,
    config,
    draft: savedPullRequest.draft,
    baseRef: savedPullRequest.baseRef,
  })
}

export const schedulePullRequestReview = async (
  tx: Transaction,
  {
    webhookEventId,
    pullRequestId,
    headSha,
    triggerSource,
  }: {
    webhookEventId: string
    pullRequestId: string
    headSha: string
    triggerSource: TriggerSource
  }
) => {
  const existingRun =
    triggerSource === "automatic"
      ? await tx.query.reviewRun.findFirst({
          where: and(
            eq(reviewRun.pullRequestId, pullRequestId),
            eq(reviewRun.headSha, headSha)
          ),
        })
      : null

  if (existingRun) {
    console.info("Skipped duplicate automatic pull request review run", {
      webhookEventId,
      reviewRunId: existingRun.id,
      pullRequestId,
      headSha,
    })
    return
  }

  const [run] = await tx
    .insert(reviewRun)
    .values({
      id: randomUUID(),
      pullRequestId,
      triggerWebhookEventId: webhookEventId,
      headSha,
      result: { triggerSource },
    })
    .returning()

  await jobs.reviewPullRequest.enqueue(tx, { reviewRunId: run.id })
  console.info("Enqueued pull request review run", {
    webhookEventId,
    reviewRunId: run.id,
    pullRequestId,
    headSha,
    triggerSource,
    maxAttempts: 5,
  })
}
