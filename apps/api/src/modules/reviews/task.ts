import { eq } from "drizzle-orm"
import { db } from "../../db/client"
import { reviewRun } from "../../db/schema"
import {
  publishReviewFailure,
  REVIEW_MODEL,
  runReviewAgent,
} from "."

type JobContext = {
  logger: {
    info: (message: string, details?: Record<string, unknown>) => void
    error: (message: string, details?: Record<string, unknown>) => void
  }
  attempt: number
  maxAttempts: number
}

export const executeReviewPullRequest = async (
  { reviewRunId }: { reviewRunId: string },
  { logger, attempt, maxAttempts }: JobContext,
) => {
  const run = await db.query.reviewRun.findFirst({
    where: eq(reviewRun.id, reviewRunId),
    with: {
      pullRequest: {
        with: {
          repository: {
            with: {
              workspace: true,
              reviewConfig: true,
            },
          },
        },
      },
    },
  })

  if (!run || run.status === "completed" || run.status === "superseded") {
    return
  }

  logger.info("Starting pull request review job", {
    reviewRunId: run.id,
    pullRequestId: run.pullRequestId,
    repository: run.pullRequest.repository.fullName,
    headSha: run.headSha,
    attempt,
    maxAttempts,
  })

  if (run.pullRequest.headSha !== run.headSha) {
    await db
      .update(reviewRun)
      .set({
        status: "superseded",
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(reviewRun.id, run.id))
    logger.info("Superseded pull request review job", {
      reviewRunId: run.id,
      pullRequestId: run.pullRequestId,
      expectedHeadSha: run.headSha,
      currentHeadSha: run.pullRequest.headSha,
    })
    return
  }

  await db
    .update(reviewRun)
    .set({
      status: "running",
      error: null,
      startedAt: run.startedAt ?? new Date(),
      updatedAt: new Date(),
    })
    .where(eq(reviewRun.id, run.id))

  try {
    const triggerSource =
      typeof run.result?.triggerSource === "string"
        ? run.result.triggerSource
        : "automatic"
    const result = await runReviewAgent({
      pullRequest: run.pullRequest,
      repository: run.pullRequest.repository,
      reviewConfig: run.pullRequest.repository.reviewConfig,
      installationId:
        run.pullRequest.repository.workspace.providerInstallationId,
      triggerSource,
      logger,
    })

    await db
      .update(reviewRun)
      .set({
        status: result.kind === "skipped" ? "skipped" : "completed",
        result,
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(reviewRun.id, run.id))
    logger.info("Completed pull request review job", {
      reviewRunId: run.id,
      pullRequestId: run.pullRequestId,
      headSha: run.headSha,
      status: result.kind === "skipped" ? "skipped" : "completed",
      durationMs: result.durationMs,
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown review workflow error"
    const isFinalAttempt = attempt >= maxAttempts
    const triggerSource =
      typeof run.result?.triggerSource === "string"
        ? run.result.triggerSource
        : "automatic"
    let commentId: number | undefined

    if (isFinalAttempt) {
      try {
        commentId = await publishReviewFailure({
          pullRequest: run.pullRequest,
          repository: run.pullRequest.repository,
          installationId:
            run.pullRequest.repository.workspace.providerInstallationId,
        })
      } catch (publishError) {
        logger.error("Failed to publish review failure notice", {
          reviewRunId: run.id,
          pullRequestId: run.pullRequestId,
          headSha: run.headSha,
          error: publishError,
        })
      }
    }

    await db
      .update(reviewRun)
      .set({
        status: isFinalAttempt ? "failed" : "running",
        error: message,
        result: isFinalAttempt
          ? {
              kind: "failed",
              triggerSource,
              modelId: REVIEW_MODEL,
              commentId,
              completedAt: new Date().toISOString(),
            }
          : run.result,
        completedAt: isFinalAttempt ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(reviewRun.id, run.id))

    logger.error("Failed to review pull request", {
      reviewRunId: run.id,
      pullRequestId: run.pullRequestId,
      headSha: run.headSha,
      attempt,
      maxAttempts,
      isFinalAttempt,
      error,
    })

    if (!isFinalAttempt) {
      throw error
    }
  }
}
