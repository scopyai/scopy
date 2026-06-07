import { eq } from "drizzle-orm"
import { db } from "../../db/client"
import { reviewRun } from "../../db/schema"
import {
  debitReviewUsage,
  hasPositiveUsageBalance,
} from "../billing/usage"
import {
  findOrCreateReviewComment,
  reviewBalanceBlockedBody,
  updateReviewComment,
} from "./github"
import {
  publishReviewFailure,
  REVIEW_MODEL,
  runReviewAgent,
} from "."
import { createReviewRunRecorder } from "./debug-run"

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

  const workspaceId = run.pullRequest.repository.workspace.id
  if (!(await hasPositiveUsageBalance(workspaceId))) {
    let commentId: number | undefined
    try {
      commentId = await findOrCreateReviewComment({
        repo: run.pullRequest.repository,
        installationId:
          run.pullRequest.repository.workspace.providerInstallationId,
        pullRequestNumber: run.pullRequest.number,
        pullRequestId: run.pullRequest.id,
      })
      await updateReviewComment({
        repo: run.pullRequest.repository,
        installationId:
          run.pullRequest.repository.workspace.providerInstallationId,
        commentId,
        pullRequestId: run.pullRequest.id,
        body: reviewBalanceBlockedBody,
      })
    } catch (publishError) {
      logger.error("Failed to publish billing blocked notice", {
        reviewRunId: run.id,
        pullRequestId: run.pullRequestId,
        error: publishError,
      })
    }

    const completedAt = new Date()
    await db
      .update(reviewRun)
      .set({
        status: "skipped",
        result: {
          kind: "billing_blocked",
          triggerSource:
            typeof run.result?.triggerSource === "string"
              ? run.result.triggerSource
              : "automatic",
          modelId: REVIEW_MODEL,
          commentId,
          skipReason: "workspace_balance_empty",
          completedAt: completedAt.toISOString(),
        },
        completedAt,
        updatedAt: completedAt,
      })
      .where(eq(reviewRun.id, run.id))
    logger.info("Skipped pull request review because workspace balance is empty", {
      reviewRunId: run.id,
      pullRequestId: run.pullRequestId,
      workspaceId,
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
      reviewRunId: run.id,
      pullRequest: run.pullRequest,
      repository: run.pullRequest.repository,
      reviewConfig: run.pullRequest.repository.reviewConfig,
      installationId:
        run.pullRequest.repository.workspace.providerInstallationId,
      triggerSource,
      logger,
    })
    let resultToStore = result
    if (result.kind === "summary" && result.billing) {
      const transaction = await debitReviewUsage({
        workspaceId,
        reviewRunId: run.id,
        pullRequestId: run.pullRequest.id,
        repositoryId: run.pullRequest.repository.id,
        modelId: result.modelId,
        verifierModelId:
          typeof result.verifierModelId === "string"
            ? result.verifierModelId
            : REVIEW_MODEL,
        llmCostMicrocents: result.billing.llmCostMicrocents,
        llmUsage: result.billing.llm,
        vector: {
          writeBytes: result.billing.vectorWriteBytes,
          queryBytes: result.billing.vectorQueryBytes,
          networkBytes: result.billing.vectorNetworkBytes,
          queryCount: result.billing.vectorQueryCount,
          writeCostMicrocents: result.billing.vectorWriteCostMicrocents,
          queryCostMicrocents: result.billing.vectorQueryCostMicrocents,
          networkCostMicrocents: result.billing.vectorNetworkCostMicrocents,
        },
      })
      resultToStore = {
        ...result,
        billing: {
          ...result.billing,
          transactionId: transaction?.id,
        },
      }
    }

    await db
      .update(reviewRun)
      .set({
        status: result.kind === "skipped" ? "skipped" : "completed",
        result: resultToStore,
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
    try {
      const recorder = await createReviewRunRecorder({
        reviewRunId: run.id,
        repo: run.pullRequest.repository,
        pullRequest: run.pullRequest,
        triggerSource,
        modelId: REVIEW_MODEL,
      })
      await recorder.writeJson("error.json", {
        message,
        attempt,
        maxAttempts,
        isFinalAttempt,
        error,
      })
      await recorder.appendEvent("review.failed", {
        message,
        attempt,
        maxAttempts,
        isFinalAttempt,
      })
    } catch (recordError) {
      logger.error("Failed to write review debug error artifacts", {
        reviewRunId: run.id,
        pullRequestId: run.pullRequestId,
        error: recordError,
      })
    }

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
