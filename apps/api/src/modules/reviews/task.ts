import { randomUUID } from "node:crypto"
import path from "node:path"
import { eq } from "drizzle-orm"
import { db } from "../../db/client"
import { reviewFinding, reviewRun } from "../../db/schema"
import { debitReviewUsage, hasPositiveUsageBalance } from "../billing/usage"
import {
  buildCompletedReviewCheckOutput,
  completeReviewCheck,
  findOrCreateReviewComment,
  reviewBalanceBlockedBody,
  startReviewCheck,
  updateReviewComment,
  type ReviewCheckConclusion,
  type ReviewCheckOutput,
} from "./github"
import { publishReviewFailure, REVIEW_MODEL, runReviewAgent } from "."
import { createReviewRunRecorder } from "./debug-run"
import { resolveReviewConfig, shouldRunAutomaticReview } from "./review-config"
import { resolveReviewCredential } from "../provider-keys/service"

type JobContext = {
  logger: {
    info: (message: string, details?: Record<string, unknown>) => void
    error: (message: string, details?: Record<string, unknown>) => void
  }
  attempt: number
  maxAttempts: number
}

type LoadedReviewRun = NonNullable<Awaited<ReturnType<typeof loadReviewRun>>>

const loadReviewRun = (reviewRunId: string) =>
  db.query.reviewRun.findFirst({
    where: eq(reviewRun.id, reviewRunId),
    with: {
      pullRequest: {
        with: {
          repository: {
            with: {
              workspace: true,
            },
          },
        },
      },
    },
  })

const syncReviewCheck = async ({
  run,
  logger,
  completion,
}: {
  run: LoadedReviewRun
  logger: JobContext["logger"]
  completion?: {
    conclusion: ReviewCheckConclusion
    output: ReviewCheckOutput
  }
}) => {
  const repo = run.pullRequest.repository
  const installationId = repo.workspace.providerInstallationId
  const intendedState = completion ? "completed" : "in_progress"

  try {
    const checkRunId =
      completion && run.providerCheckRunId
        ? run.providerCheckRunId
        : await startReviewCheck({
            repo,
            installationId,
            reviewRunId: run.id,
            headSha: run.headSha,
            checkRunId: run.providerCheckRunId,
            detailsUrl: run.pullRequest.htmlUrl,
          })

    if (completion) {
      await completeReviewCheck({
        repo,
        installationId,
        checkRunId,
        conclusion: completion.conclusion,
        output: completion.output,
        detailsUrl: run.pullRequest.htmlUrl,
      })
    }

    await db
      .update(reviewRun)
      .set({
        providerCheckRunId: checkRunId,
        checkSyncError: null,
        updatedAt: new Date(),
      })
      .where(eq(reviewRun.id, run.id))

    run.providerCheckRunId = checkRunId
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown GitHub Check sync error"
    await db
      .update(reviewRun)
      .set({ checkSyncError: message, updatedAt: new Date() })
      .where(eq(reviewRun.id, run.id))
    logger.error("Failed to synchronize GitHub Check", {
      reviewRunId: run.id,
      repository: repo.fullName,
      headSha: run.headSha,
      checkRunId: run.providerCheckRunId,
      intendedState,
      error,
    })
  }
}

const languageByExtension: Record<string, string> = {
  ".c": "c",
  ".cc": "cpp",
  ".cpp": "cpp",
  ".cs": "csharp",
  ".css": "css",
  ".go": "go",
  ".html": "html",
  ".java": "java",
  ".js": "javascript",
  ".jsx": "javascript",
  ".kt": "kotlin",
  ".mjs": "javascript",
  ".php": "php",
  ".py": "python",
  ".rb": "ruby",
  ".rs": "rust",
  ".scala": "scala",
  ".sh": "shell",
  ".swift": "swift",
  ".ts": "typescript",
  ".tsx": "typescript",
  ".vue": "vue",
}

const languageForFile = (file: string) =>
  languageByExtension[path.extname(file).toLowerCase()] ?? "unknown"

export const executeReviewPullRequest = async (
  { reviewRunId }: { reviewRunId: string },
  { logger, attempt, maxAttempts }: JobContext
) => {
  const run = await loadReviewRun(reviewRunId)

  if (
    !run ||
    run.status === "completed" ||
    run.status === "skipped" ||
    run.status === "superseded"
  ) {
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

  if (!run.pullRequest.repository.enabled) {
    const completedAt = new Date()
    await db
      .update(reviewRun)
      .set({
        status: "skipped",
        result: {
          kind: "repository_disabled",
          triggerSource:
            run.result?.triggerSource === "mention" ? "mention" : "automatic",
          skipReason: "repository_disabled",
          completedAt: completedAt.toISOString(),
        },
        completedAt,
        updatedAt: completedAt,
      })
      .where(eq(reviewRun.id, run.id))
    await syncReviewCheck({
      run,
      logger,
      completion: {
        conclusion: "neutral",
        output: {
          title: "Review skipped",
          summary:
            "Repository reviews were disabled before this review started.",
        },
      },
    })
    return
  }

  await syncReviewCheck({ run, logger })

  const workspaceId = run.pullRequest.repository.workspace.id
  const triggerSource =
    typeof run.result?.triggerSource === "string"
      ? run.result.triggerSource
      : "automatic"
  const effectiveReviewConfig = resolveReviewConfig(
    run.pullRequest.repository.workspace,
    run.pullRequest.repository
  )
  const billingMode =
    run.pullRequest.repository.reviewBillingMode ??
    run.pullRequest.repository.workspace.reviewBillingMode
  const reviewCommentRunId = triggerSource === "mention" ? run.id : undefined

  if (
    triggerSource === "automatic" &&
    !shouldRunAutomaticReview({
      config: effectiveReviewConfig,
      draft: run.pullRequest.draft,
      baseRef: run.pullRequest.baseRef,
    })
  ) {
    const completedAt = new Date()
    await db
      .update(reviewRun)
      .set({
        status: "skipped",
        result: {
          kind: "settings_changed",
          triggerSource,
          skipReason: "automatic_review_settings",
          completedAt: completedAt.toISOString(),
        },
        completedAt,
        updatedAt: completedAt,
      })
      .where(eq(reviewRun.id, run.id))
    await syncReviewCheck({
      run,
      logger,
      completion: {
        conclusion: "neutral",
        output: {
          title: "Review skipped",
          summary:
            "The repository review settings changed before this review started.",
        },
      },
    })
    return
  }

  const skipBlockedReview = async (options: {
    skipReason: string
    commentBody: string
    logMessage: string
    checkTitle: string
    checkSummary: string
  }) => {
    let commentId: number | undefined
    try {
      commentId = await findOrCreateReviewComment({
        repo: run.pullRequest.repository,
        installationId:
          run.pullRequest.repository.workspace.providerInstallationId,
        pullRequestNumber: run.pullRequest.number,
        pullRequestId: run.pullRequest.id,
        reviewRunId: reviewCommentRunId,
      })
      await updateReviewComment({
        repo: run.pullRequest.repository,
        installationId:
          run.pullRequest.repository.workspace.providerInstallationId,
        commentId,
        pullRequestId: run.pullRequest.id,
        reviewRunId: reviewCommentRunId,
        body: options.commentBody,
      })
    } catch (publishError) {
      logger.error("Failed to publish review skip notice", {
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
          triggerSource,
          modelId: REVIEW_MODEL,
          commentId,
          skipReason: options.skipReason,
          completedAt: completedAt.toISOString(),
        },
        completedAt,
        updatedAt: completedAt,
      })
      .where(eq(reviewRun.id, run.id))
    logger.info(options.logMessage, {
      reviewRunId: run.id,
      pullRequestId: run.pullRequestId,
      workspaceId,
    })
    await syncReviewCheck({
      run,
      logger,
      completion: {
        conclusion: "action_required",
        output: { title: options.checkTitle, summary: options.checkSummary },
      },
    })
  }

  const credential = await resolveReviewCredential({
    workspaceId,
    billingMode,
    preferredProvider:
      run.pullRequest.repository.byokProvider ??
      run.pullRequest.repository.workspace.byokProvider,
  })

  if (credential.status === "missing_key") {
    await skipBlockedReview({
      skipReason: "byok_key_missing",
      commentBody:
        "This review is set to use your own provider API key (bring-your-own-key), but no key is configured. Add an OpenRouter or Vercel AI Gateway key in your workspace settings, or switch this repository back to platform billing.",
      logMessage: "Skipped review because no BYOK key is configured",
      checkTitle: "Review requires a provider key",
      checkSummary:
        "This repository is set to bring-your-own-key but no provider API key is configured. See the pull request comment for details.",
    })
    return
  }

  if (
    billingMode === "platform" &&
    !(await hasPositiveUsageBalance(workspaceId))
  ) {
    await skipBlockedReview({
      skipReason: "workspace_balance_empty",
      commentBody: reviewBalanceBlockedBody,
      logMessage: "Skipped review because workspace balance is empty",
      checkTitle: "Review requires billing action",
      checkSummary:
        "The review could not start because this workspace has no remaining usage balance. See the pull request comment for details.",
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
    const result = await runReviewAgent({
      reviewRunId: run.id,
      pullRequest: run.pullRequest,
      repository: run.pullRequest.repository,
      reviewConfig: effectiveReviewConfig,
      installationId:
        run.pullRequest.repository.workspace.providerInstallationId,
      triggerSource,
      logger,
      credential,
    })
    let resultToStore = result
    if (
      billingMode === "platform" &&
      result.kind === "summary" &&
      result.billing
    ) {
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

    const completedAt = new Date()
    await db.transaction(async (tx) => {
      await tx
        .update(reviewRun)
        .set({
          status: result.kind === "skipped" ? "skipped" : "completed",
          result: resultToStore,
          completedAt,
          updatedAt: completedAt,
        })
        .where(eq(reviewRun.id, run.id))

      await tx
        .delete(reviewFinding)
        .where(eq(reviewFinding.reviewRunId, run.id))

      if (result.kind === "summary" && result.findings?.length) {
        await tx.insert(reviewFinding).values(
          result.findings.map((finding) => ({
            id: randomUUID(),
            reviewRunId: run.id,
            severity: finding.severity,
            file: finding.file,
            startLine: finding.startLine,
            endLine: finding.endLine,
            title: finding.title,
            confidence: finding.confidence,
            language: languageForFile(finding.file),
          }))
        )
      }
    })
    logger.info("Completed pull request review job", {
      reviewRunId: run.id,
      pullRequestId: run.pullRequestId,
      headSha: run.headSha,
      status: result.kind === "skipped" ? "skipped" : "completed",
      durationMs: result.durationMs,
    })
    const partialPublication = Boolean(result.inlineReviewPublishError)
    await syncReviewCheck({
      run,
      logger,
      completion: {
        conclusion:
          result.kind === "skipped" || partialPublication
            ? "neutral"
            : "success",
        output:
          result.kind === "skipped"
            ? {
                title: "Review skipped",
                summary: `${result.skipReason ?? "No review was required."}\n\nSee the pull request summary for details.`,
              }
            : buildCompletedReviewCheckOutput({
                durationMs: result.durationMs,
                reviewedFileCount: result.filteredFileCount,
                findings: result.findings,
                partialPublication,
              }),
      },
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown review workflow error"
    const isFinalAttempt = attempt >= maxAttempts
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
          reviewRunId: run.id,
          triggerSource,
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

    if (isFinalAttempt) {
      await syncReviewCheck({
        run,
        logger,
        completion: {
          conclusion: "failure",
          output: {
            title: "Review failed",
            summary:
              "The review could not be completed after several retries. See the pull request comment for details.",
          },
        },
      })
    }

    if (!isFinalAttempt) {
      throw error
    }
  }
}
