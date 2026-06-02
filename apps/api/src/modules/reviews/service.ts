import { randomUUID } from "node:crypto"
import { and, eq } from "drizzle-orm"
import { db } from "../../db/client"
import { pullRequest, reviewConfig, reviewRun } from "../../db/schema"
import { env } from "../../env"
import { jobs } from "../../jobs/definitions"
import { containsBotMention, isBotAuthoredComment } from "./triggers"

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
type TriggerSource = "automatic" | "mention"

const automaticReviewActions = new Set(["opened", "ready_for_review"])

const matchesBranchPattern = (branch: string, pattern: string) => {
  const expression = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")

  return new RegExp(`^${expression}$`).test(branch)
}

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
        !isBotAuthoredComment(commentAuthor, appSlug),
    )

  if (!isAutomatic && !isMention) {
    return null
  }

  const config = await db.query.reviewConfig.findFirst({
    where: eq(reviewConfig.repositoryId, savedPullRequest.repositoryId),
  })

  if (!config?.enabled || !config.reviewPullRequests) {
    return null
  }

  if (isMention) {
    return "mention"
  }

  return (config.reviewDrafts || !savedPullRequest.draft) &&
    config.baseBranchPatterns.some((pattern) =>
      matchesBranchPattern(savedPullRequest.baseRef, pattern),
    )
    ? "automatic"
    : null
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
  },
) => {
  const existingRun =
    triggerSource === "automatic"
      ? await tx.query.reviewRun.findFirst({
          where: and(
            eq(reviewRun.pullRequestId, pullRequestId),
            eq(reviewRun.headSha, headSha),
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
