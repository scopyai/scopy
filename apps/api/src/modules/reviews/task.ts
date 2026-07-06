import { randomUUID } from "node:crypto"
import path from "node:path"
import { eq } from "drizzle-orm"
import { db } from "../../db/client"
import { reviewFinding, reviewRun } from "../../db/schema"
import {
  recordReviewUsage,
  refundReviewCredits,
  reserveReviewCredits,
} from "../billing/usage"
import { calculateReviewCredits } from "@workspace/billing/plans"
import {
  annotatePullRequestFilesForReview,
  countPullRequestChangedLines,
  filterPullRequestFiles,
  getDiffSkipReason,
  serializePullRequestFiles,
  serializePullRequestFilesAsUnifiedDiff,
} from "./diff"
import {
  buildCompletedReviewCheckOutput,
  completeReviewCheck,
  findOrCreateReviewComment,
  listPullRequestFiles,
  reviewCreditsBlockedBody,
  startReviewCheck,
  updateReviewComment,
  type ReviewCheckConclusion,
  type ReviewCheckOutput,
} from "./github"
import {
  publishReviewFailure,
  REVIEW_MODEL,
  runReviewAgent,
  type ReviewPreflight,
} from "."
import { createReviewRunRecorder } from "./debug-run"
import { resolveReviewConfig, shouldRunAutomaticReview } from "./review-config"

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

const buildReviewPreflight = async ({
  run,
  effectiveReviewConfig,
}: {
  run: LoadedReviewRun
  effectiveReviewConfig: ReturnType<typeof resolveReviewConfig>
}): Promise<ReviewPreflight> => {
  const files = await listPullRequestFiles({
    repo: run.pullRequest.repository,
    installationId: run.pullRequest.repository.workspace.providerInstallationId,
    pullRequestNumber: run.pullRequest.number,
  })
  const filteredFiles = filterPullRequestFiles(
    files,
    effectiveReviewConfig.pathIncludePatterns,
    effectiveReviewConfig.pathExcludePatterns
  )
  const visibleFiles = annotatePullRequestFilesForReview(
    files,
    effectiveReviewConfig.pathIncludePatterns,
    effectiveReviewConfig.pathExcludePatterns
  )
  const omittedFiles = visibleFiles.filter((file) => file.omittedReason)
  const diff = serializePullRequestFiles(visibleFiles)
  const unifiedDiff = serializePullRequestFilesAsUnifiedDiff(filteredFiles)
  const additions = filteredFiles.reduce(
    (total, file) => total + file.additions,
    0
  )
  const deletions = filteredFiles.reduce(
    (total, file) => total + file.deletions,
    0
  )
  const diffChangedLineCount = countPullRequestChangedLines(filteredFiles)

  return {
    fetchedFileCount: files.length,
    filteredFiles,
    omittedFiles,
    diff,
    unifiedDiff,
    additions,
    deletions,
    diffChangedLineCount,
  }
}

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

  const workspaceId = run.pullRequest.repository.workspace.id
  if (run.pullRequest.headSha !== run.headSha) {
    await refundReviewCredits({ workspaceId, reviewRunId: run.id })
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
    await refundReviewCredits({ workspaceId, reviewRunId: run.id })
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

  const triggerSource =
    typeof run.result?.triggerSource === "string"
      ? run.result.triggerSource
      : "automatic"
  const effectiveReviewConfig = resolveReviewConfig(
    run.pullRequest.repository.workspace,
    run.pullRequest.repository
  )
  const reviewCommentRunId = triggerSource === "mention" ? run.id : undefined

  if (
    triggerSource === "automatic" &&
    !shouldRunAutomaticReview({
      config: effectiveReviewConfig,
      draft: run.pullRequest.draft,
      baseRef: run.pullRequest.baseRef,
    })
  ) {
    await refundReviewCredits({ workspaceId, reviewRunId: run.id })
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

  const skipReview = async (options: {
    skipReason: string
    commentBody: string
    logMessage: string
    checkTitle: string
    checkSummary: string
    checkConclusion: ReviewCheckConclusion
    resultKind: string
    extraResult?: Record<string, unknown>
  }) => {
    await refundReviewCredits({ workspaceId, reviewRunId: run.id })
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
          kind: options.resultKind,
          triggerSource,
          modelId: REVIEW_MODEL,
          commentId,
          skipReason: options.skipReason,
          ...options.extraResult,
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
        conclusion: options.checkConclusion,
        output: { title: options.checkTitle, summary: options.checkSummary },
      },
    })
  }

  const preflight = await buildReviewPreflight({ run, effectiveReviewConfig })
  const diffSkipReason =
    preflight.filteredFiles.length === 0
      ? [
          "No reviewable file contents matched this repository's path filters.",
          ...(preflight.omittedFiles.length > 0
            ? [
                "",
                "Omitted changed files:",
                ...preflight.omittedFiles.map(
                  (file) => `- ${file.filename}: ${file.omittedReason}`
                ),
              ]
            : []),
        ].join("\n")
      : getDiffSkipReason(
          preflight.diffChangedLineCount,
          effectiveReviewConfig.maxReviewChangedLines
        )

  if (diffSkipReason) {
    await skipReview({
      resultKind: "skipped",
      skipReason: diffSkipReason,
      commentBody: `## Review summary\n\n${diffSkipReason}`,
      logMessage: "Skipped review during preflight",
      checkTitle: "Review skipped",
      checkSummary: diffSkipReason,
      checkConclusion: "neutral",
      extraResult: {
        fetchedFileCount: preflight.fetchedFileCount,
        filteredFileCount: preflight.filteredFiles.length,
        additions: preflight.additions,
        deletions: preflight.deletions,
        diffChangedLineCount: preflight.diffChangedLineCount,
      },
    })
    return
  }

  const creditsRequired = calculateReviewCredits(preflight.diffChangedLineCount)
  const creditReservation = await reserveReviewCredits({
    workspaceId,
    reviewRunId: run.id,
    repositoryId: run.pullRequest.repository.id,
    pullRequestId: run.pullRequest.id,
    credits: creditsRequired,
    reviewableAdditions: preflight.additions,
    reviewableDeletions: preflight.deletions,
    reviewableChangedLines: preflight.diffChangedLineCount,
  })
  if (!creditReservation.ok) {
    await skipReview({
      resultKind: "billing_blocked",
      skipReason: "insufficient_review_credits",
      commentBody: reviewCreditsBlockedBody({
        requiredCredits: creditReservation.requiredCredits,
        availableCredits: creditReservation.availableCredits,
      }),
      logMessage: "Skipped review because workspace has insufficient credits",
      checkTitle: "Review requires credits",
      checkSummary: `The review requires ${creditReservation.requiredCredits.toLocaleString("en-US")} credit${creditReservation.requiredCredits === 1 ? "" : "s"}, but this workspace has ${creditReservation.availableCredits.toLocaleString("en-US")} available. See the pull request comment for details.`,
      checkConclusion: "action_required",
      extraResult: {
        requiredCredits: creditReservation.requiredCredits,
        availableCredits: creditReservation.availableCredits,
        fetchedFileCount: preflight.fetchedFileCount,
        filteredFileCount: preflight.filteredFiles.length,
        additions: preflight.additions,
        deletions: preflight.deletions,
        diffChangedLineCount: preflight.diffChangedLineCount,
      },
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
      preflight,
    })
    if (result.billing) {
      await recordReviewUsage({
        reviewRunId: run.id,
        workspaceId,
        repositoryId: run.pullRequest.repository.id,
        pullRequestId: run.pullRequest.id,
        modelId: result.modelId,
        verifierModelId:
          typeof result.verifierModelId === "string"
            ? result.verifierModelId
            : REVIEW_MODEL,
        billing: result.billing,
        creditsCharged: creditReservation.creditsCharged,
        reviewableAdditions: preflight.additions,
        reviewableDeletions: preflight.deletions,
        reviewableChangedLines: preflight.diffChangedLineCount,
      })
    }

    const completedAt = new Date()
    await db.transaction(async (tx) => {
      await tx
        .update(reviewRun)
        .set({
          status: "completed",
          result,
          completedAt,
          updatedAt: completedAt,
        })
        .where(eq(reviewRun.id, run.id))

      await tx
        .delete(reviewFinding)
        .where(eq(reviewFinding.reviewRunId, run.id))

      if (result.findings?.length) {
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
      status: "completed",
      durationMs: result.durationMs,
    })
    const partialPublication = Boolean(result.inlineReviewPublishError)
    await syncReviewCheck({
      run,
      logger,
      completion: {
        conclusion: partialPublication ? "neutral" : "success",
        output: buildCompletedReviewCheckOutput({
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
      await refundReviewCredits({
        workspaceId,
        reviewRunId: run.id,
      })
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
