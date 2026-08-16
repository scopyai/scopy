import { randomUUID } from "node:crypto"
import { and, eq, sql } from "drizzle-orm"
import { db } from "../../db/client"
import { pullRequest, reviewRun } from "../../db/schema"
import { env } from "../../env"
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

  if (!repo || !repo.enabled) {
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
  if (triggerSource === "automatic") {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`automatic-review:${pullRequestId}:${headSha}`}))`
    )
  }

  const existingWebhookRun = await tx.query.reviewRun.findFirst({
    where: eq(reviewRun.triggerWebhookEventId, webhookEventId),
  })
  const existingRun =
    existingWebhookRun ??
    (triggerSource === "automatic"
      ? await tx.query.reviewRun.findFirst({
          where: and(
            eq(reviewRun.pullRequestId, pullRequestId),
            eq(reviewRun.headSha, headSha)
          ),
        })
      : null)

  if (existingRun) {
    console.info("Reused existing pull request review run", {
      webhookEventId,
      reviewRunId: existingRun.id,
      pullRequestId,
      headSha,
    })
    return existingRun.id
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

  console.info("Created pull request review run", {
    webhookEventId,
    reviewRunId: run.id,
    pullRequestId,
    headSha,
    triggerSource,
  })
  return run.id
}
