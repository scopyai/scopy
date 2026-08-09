import { randomUUID } from "node:crypto"
import path from "node:path"
import { eq } from "drizzle-orm"
import { calculateReviewCredits } from "@workspace/billing/plans"
import { db } from "../../db/client"
import { reviewFinding, reviewRun } from "../../db/schema"
import {
  recordReviewUsage,
  refundReviewCredits,
  reserveReviewCredits,
} from "../billing/usage"
import {
  annotatePullRequestFilesForReview,
  countPullRequestChangedLines,
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
  publishReviewAnalysis,
  publishReviewFailure,
  REVIEW_MODEL,
  runReviewAnalysis,
  type ReviewAgentResult,
  type ReviewAnalysisResult,
  type ReviewPreflight,
} from "."
import { resolveReviewConfig, shouldRunAutomaticReview } from "./review-config"
import { cleanupReviewRunRecorder } from "./debug-run"
import { cleanupReviewRuntime } from "./runtime"

export type JobLogger = {
  info: (message: string, details?: Record<string, unknown>) => void
  error: (message: string, details?: Record<string, unknown>) => void
}

type LoadedReviewRun = NonNullable<Awaited<ReturnType<typeof loadReviewRun>>>

const loadReviewRun = (reviewRunId: string) =>
  db.query.reviewRun.findFirst({
    where: eq(reviewRun.id, reviewRunId),
    with: {
      pullRequest: {
        with: {
          repository: {
            with: { workspace: true },
          },
        },
      },
    },
  })

const triggerSourceFor = (run: LoadedReviewRun) =>
  run.result?.triggerSource === "mention" ? "mention" : "automatic"

const isTerminal = (run: LoadedReviewRun) =>
  ["completed", "skipped", "superseded", "failed"].includes(run.status)

const asAnalysis = (value: Record<string, unknown> | null) =>
  value?.kind === "analysis" ? (value as ReviewAnalysisResult) : null

const asPublishedReview = (value: Record<string, unknown> | null) =>
  value?.kind === "summary" ? (value as ReviewAgentResult) : null

const syncReviewCheck = async ({
  run,
  logger,
  completion,
}: {
  run: LoadedReviewRun
  logger: JobLogger
  completion?: {
    conclusion: ReviewCheckConclusion
    output: ReviewCheckOutput
  }
}) => {
  const repo = run.pullRequest.repository
  const installationId = repo.workspace.providerInstallationId

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
      .set({ providerCheckRunId: checkRunId, checkSyncError: null })
      .where(eq(reviewRun.id, run.id))
    run.providerCheckRunId = checkRunId
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown GitHub Check sync error"
    await db
      .update(reviewRun)
      .set({ checkSyncError: message })
      .where(eq(reviewRun.id, run.id))
    logger.error("Failed to synchronize GitHub Check", {
      reviewRunId: run.id,
      repository: repo.fullName,
      error,
    })
  }
}

const buildReviewPreflight = async (run: LoadedReviewRun) => {
  const config = resolveReviewConfig(
    run.pullRequest.repository.workspace,
    run.pullRequest.repository
  )
  const files = await listPullRequestFiles({
    repo: run.pullRequest.repository,
    installationId: run.pullRequest.repository.workspace.providerInstallationId,
    pullRequestNumber: run.pullRequest.number,
  })
  const visibleFiles = annotatePullRequestFilesForReview(
    files,
    config.pathIncludePatterns,
    config.pathExcludePatterns
  )
  const filteredFiles = visibleFiles.filter((file) => !file.omittedReason)
  const omittedFiles = visibleFiles.filter((file) => file.omittedReason)

  return {
    config,
    preflight: {
      fetchedFileCount: files.length,
      filteredFiles,
      omittedFiles,
      diff: serializePullRequestFiles(visibleFiles),
      unifiedDiff: serializePullRequestFilesAsUnifiedDiff(filteredFiles),
      additions: filteredFiles.reduce(
        (total, file) => total + file.additions,
        0
      ),
      deletions: filteredFiles.reduce(
        (total, file) => total + file.deletions,
        0
      ),
      diffChangedLineCount: countPullRequestChangedLines(filteredFiles),
    } satisfies ReviewPreflight,
  }
}

const skipReview = async ({
  run,
  logger,
  resultKind,
  skipReason,
  commentBody,
  checkTitle,
  checkSummary,
  checkConclusion,
  extraResult,
}: {
  run: LoadedReviewRun
  logger: JobLogger
  resultKind: string
  skipReason: string
  commentBody?: string
  checkTitle: string
  checkSummary: string
  checkConclusion: ReviewCheckConclusion
  extraResult?: Record<string, unknown>
}) => {
  const repo = run.pullRequest.repository
  const triggerSource = triggerSourceFor(run)
  await refundReviewCredits({
    workspaceId: repo.workspace.id,
    reviewRunId: run.id,
  })

  let commentId: number | undefined
  if (commentBody) {
    try {
      const reviewCommentRunId =
        triggerSource === "mention" ? run.id : undefined
      commentId = await findOrCreateReviewComment({
        repo,
        installationId: repo.workspace.providerInstallationId,
        pullRequestNumber: run.pullRequest.number,
        pullRequestId: run.pullRequest.id,
        reviewRunId: reviewCommentRunId,
      })
      await updateReviewComment({
        repo,
        installationId: repo.workspace.providerInstallationId,
        commentId,
        pullRequestId: run.pullRequest.id,
        reviewRunId: reviewCommentRunId,
        body: commentBody,
      })
    } catch (error) {
      logger.error("Failed to publish review skip notice", {
        reviewRunId: run.id,
        error,
      })
    }
  }

  const completedAt = new Date()
  await db
    .update(reviewRun)
    .set({
      status: "skipped",
      result: {
        kind: resultKind,
        triggerSource,
        modelId: REVIEW_MODEL,
        commentId,
        skipReason,
        ...extraResult,
        completedAt: completedAt.toISOString(),
      },
      completedAt,
      error: null,
    })
    .where(eq(reviewRun.id, run.id))

  await syncReviewCheck({
    run,
    logger,
    completion: {
      conclusion: checkConclusion,
      output: { title: checkTitle, summary: checkSummary },
    },
  })
}

export const prepareReviewPullRequest = async (
  { reviewRunId }: { reviewRunId: string },
  logger: JobLogger
) => {
  const run = await loadReviewRun(reviewRunId)
  if (
    !run ||
    isTerminal(run) ||
    asAnalysis(run.result) ||
    asPublishedReview(run.result)
  ) {
    return { ready: false }
  }

  const repo = run.pullRequest.repository
  const workspaceId = repo.workspace.id
  const triggerSource = triggerSourceFor(run)

  if (run.pullRequest.headSha !== run.headSha) {
    await refundReviewCredits({ workspaceId, reviewRunId: run.id })
    await db
      .update(reviewRun)
      .set({ status: "superseded", completedAt: new Date() })
      .where(eq(reviewRun.id, run.id))
    return { ready: false }
  }

  if (!repo.enabled) {
    await skipReview({
      run,
      logger,
      resultKind: "repository_disabled",
      skipReason: "repository_disabled",
      checkTitle: "Review skipped",
      checkSummary:
        "Repository reviews were disabled before this review started.",
      checkConclusion: "neutral",
    })
    return { ready: false }
  }

  await syncReviewCheck({ run, logger })
  const config = resolveReviewConfig(repo.workspace, repo)

  if (
    triggerSource === "automatic" &&
    !shouldRunAutomaticReview({
      config,
      draft: run.pullRequest.draft,
      baseRef: run.pullRequest.baseRef,
    })
  ) {
    await skipReview({
      run,
      logger,
      resultKind: "settings_changed",
      skipReason: "automatic_review_settings",
      checkTitle: "Review skipped",
      checkSummary:
        "The repository review settings changed before this review started.",
      checkConclusion: "neutral",
    })
    return { ready: false }
  }

  await db
    .update(reviewRun)
    .set({
      status: "running",
      error: null,
      startedAt: run.startedAt ?? new Date(),
      completedAt: null,
    })
    .where(eq(reviewRun.id, run.id))
  logger.info("Prepared pull request review", { reviewRunId })
  return { ready: true }
}

export const analyzeReviewPullRequest = async (
  { reviewRunId }: { reviewRunId: string },
  logger: JobLogger
) => {
  const run = await loadReviewRun(reviewRunId)
  if (!run || isTerminal(run) || asPublishedReview(run.result)) return
  if (asAnalysis(run.result)) return
  if (run.status !== "running") return

  if (run.pullRequest.headSha !== run.headSha) {
    await refundReviewCredits({
      workspaceId: run.pullRequest.repository.workspace.id,
      reviewRunId,
    })
    await db
      .update(reviewRun)
      .set({ status: "superseded", completedAt: new Date() })
      .where(eq(reviewRun.id, reviewRunId))
    return
  }

  const { config, preflight } = await buildReviewPreflight(run)
  const diffSkipReason =
    preflight.filteredFiles.length === 0
      ? "No reviewable file contents matched this repository's path filters."
      : getDiffSkipReason(
          preflight.diffChangedLineCount,
          config.maxReviewChangedLines
        )
  const stats = {
    fetchedFileCount: preflight.fetchedFileCount,
    filteredFileCount: preflight.filteredFiles.length,
    additions: preflight.additions,
    deletions: preflight.deletions,
    diffChangedLineCount: preflight.diffChangedLineCount,
  }
  if (diffSkipReason) {
    await skipReview({
      run,
      logger,
      resultKind: "skipped",
      skipReason: diffSkipReason,
      commentBody: `## Review summary\n\n${diffSkipReason}`,
      checkTitle: "Review skipped",
      checkSummary: diffSkipReason,
      checkConclusion: "neutral",
      extraResult: stats,
    })
    return
  }

  const creditsRequired = calculateReviewCredits(preflight.diffChangedLineCount)
  const reservation = await reserveReviewCredits({
    workspaceId: run.pullRequest.repository.workspace.id,
    reviewRunId,
    repositoryId: run.pullRequest.repository.id,
    pullRequestId: run.pullRequest.id,
    credits: creditsRequired,
    reviewableAdditions: preflight.additions,
    reviewableDeletions: preflight.deletions,
    reviewableChangedLines: preflight.diffChangedLineCount,
  })
  if (!reservation.ok) {
    const summary = `The review requires ${reservation.requiredCredits} credit${reservation.requiredCredits === 1 ? "" : "s"}, but this workspace has ${reservation.availableCredits} available.`
    await skipReview({
      run,
      logger,
      resultKind: "billing_blocked",
      skipReason: "insufficient_review_credits",
      commentBody: reviewCreditsBlockedBody({
        requiredCredits: reservation.requiredCredits,
        availableCredits: reservation.availableCredits,
      }),
      checkTitle: "Review requires credits",
      checkSummary: summary,
      checkConclusion: "action_required",
      extraResult: {
        ...stats,
        requiredCredits: reservation.requiredCredits,
        availableCredits: reservation.availableCredits,
      },
    })
    return
  }

  const analysis = await runReviewAnalysis({
    reviewRunId,
    pullRequest: run.pullRequest,
    repository: run.pullRequest.repository,
    reviewConfig: config,
    installationId: run.pullRequest.repository.workspace.providerInstallationId,
    triggerSource: triggerSourceFor(run),
    logger,
    preflight,
  })
  await db
    .update(reviewRun)
    .set({
      result: analysis as unknown as Record<string, unknown>,
      error: null,
    })
    .where(eq(reviewRun.id, reviewRunId))
}

export const publishReviewPullRequest = async (
  { reviewRunId }: { reviewRunId: string },
  logger: JobLogger
) => {
  const run = await loadReviewRun(reviewRunId)
  if (!run || isTerminal(run) || asPublishedReview(run.result)) return
  const analysis = asAnalysis(run.result)
  if (!analysis) return

  const result = await publishReviewAnalysis({
    reviewRunId,
    pullRequest: run.pullRequest,
    repository: run.pullRequest.repository,
    installationId: run.pullRequest.repository.workspace.providerInstallationId,
    triggerSource: triggerSourceFor(run),
    logger,
    analysis,
  })
  await db
    .update(reviewRun)
    .set({ result: result as unknown as Record<string, unknown>, error: null })
    .where(eq(reviewRun.id, reviewRunId))
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

export const finalizeReviewPullRequest = async (
  { reviewRunId }: { reviewRunId: string },
  logger: JobLogger
) => {
  const run = await loadReviewRun(reviewRunId)
  if (!run || isTerminal(run)) return
  const result = asPublishedReview(run.result)
  if (!result) return

  const repo = run.pullRequest.repository
  if (result.billing) {
    await recordReviewUsage({
      reviewRunId,
      workspaceId: repo.workspace.id,
      repositoryId: repo.id,
      pullRequestId: run.pullRequest.id,
      modelId: result.modelId,
      verifierModelId: result.verifierModelId,
      billing: result.billing,
      reviewableAdditions: result.reviewableAdditions,
      reviewableDeletions: result.reviewableDeletions,
      reviewableChangedLines: result.diffChangedLineCount,
    })
  }

  const completedAt = new Date()
  await db.transaction(async (tx) => {
    await tx
      .update(reviewRun)
      .set({ status: "completed", completedAt, error: null })
      .where(eq(reviewRun.id, reviewRunId))
    await tx
      .delete(reviewFinding)
      .where(eq(reviewFinding.reviewRunId, reviewRunId))
    if (result.findings?.length) {
      await tx.insert(reviewFinding).values(
        result.findings.map((finding) => ({
          id: randomUUID(),
          reviewRunId,
          severity: finding.severity,
          file: finding.file,
          startLine: finding.startLine,
          endLine: finding.endLine,
          title: finding.title,
          language:
            languageByExtension[path.extname(finding.file).toLowerCase()] ??
            "unknown",
        }))
      )
    }
  })

  await syncReviewCheck({
    run,
    logger,
    completion: {
      conclusion: result.inlineReviewPublishError ? "neutral" : "success",
      output: buildCompletedReviewCheckOutput({
        durationMs: result.durationMs,
        reviewedFileCount: result.filteredFileCount,
        findings: result.findings,
        partialPublication: Boolean(result.inlineReviewPublishError),
      }),
    },
  })
  logger.info("Finalized pull request review", { reviewRunId })
}

export const failReviewPullRequest = async (
  { reviewRunId }: { reviewRunId: string },
  logger: JobLogger,
  error?: unknown
) => {
  const run = await loadReviewRun(reviewRunId)
  if (!run || isTerminal(run)) return
  const repo = run.pullRequest.repository
  const message =
    error instanceof Error ? error.message : String(error ?? "Review failed")

  await refundReviewCredits({ workspaceId: repo.workspace.id, reviewRunId })
  let commentId: number | undefined
  try {
    commentId = await publishReviewFailure({
      pullRequest: run.pullRequest,
      repository: repo,
      installationId: repo.workspace.providerInstallationId,
      reviewRunId,
      triggerSource: triggerSourceFor(run),
    })
  } catch (publishError) {
    logger.error("Failed to publish review failure notice", {
      reviewRunId,
      error: publishError,
    })
  }

  const completedAt = new Date()
  await db
    .update(reviewRun)
    .set({
      status: "failed",
      error: message,
      result: {
        kind: "failed",
        triggerSource: triggerSourceFor(run),
        modelId: REVIEW_MODEL,
        commentId,
        completedAt: completedAt.toISOString(),
      },
      completedAt,
    })
    .where(eq(reviewRun.id, reviewRunId))

  await syncReviewCheck({
    run,
    logger,
    completion: {
      conclusion: "failure",
      output: {
        title: "Review failed",
        summary: "The review could not be completed after two attempts.",
      },
    },
  })
}

export const cleanupReviewPullRequestArtifacts = async (
  { reviewRunId }: { reviewRunId: string },
  logger: JobLogger
) => {
  const run = await loadReviewRun(reviewRunId)
  if (!run) return

  const repo = run.pullRequest.repository
  const cleaned = await Promise.all([
    cleanupReviewRuntime({
      repositoryId: repo.id,
      headSha: run.headSha,
      reviewRunId,
    }),
    cleanupReviewRunRecorder({
      reviewRunId,
      repositoryId: repo.id,
      pullRequestNumber: run.pullRequest.number,
      headSha: run.headSha,
    }),
  ])
  if (cleaned.some(Boolean)) {
    logger.info("Cleaned pull request review artifacts", { reviewRunId })
  }
}
