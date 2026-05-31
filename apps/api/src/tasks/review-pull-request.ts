import { eq } from "drizzle-orm"
import type { Task } from "graphile-worker"
import { z } from "zod"
import { db } from "../db/client"
import { reviewRun } from "../db/schema"
import { acknowledgeGitHubPullRequestOpened } from "../services/pull-requests"

const payloadSchema = z.object({
  reviewRunId: z.string().uuid(),
})

export const reviewPullRequest: Task = async (payload, helpers) => {
  const { reviewRunId } = payloadSchema.parse(payload)
  const run = await db.query.reviewRun.findFirst({
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

  if (!run || run.status === "completed" || run.status === "superseded") {
    return
  }

  if (run.pullRequest.headSha !== run.headSha) {
    await db
      .update(reviewRun)
      .set({
        status: "superseded",
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(reviewRun.id, run.id))
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
    await acknowledgeGitHubPullRequestOpened(
      run.pullRequest.repository,
      run.pullRequest.repository.workspace.providerInstallationId,
      run.pullRequest.number,
      run.pullRequest.id,
    )

    await db
      .update(reviewRun)
      .set({
        status: "completed",
        result: {
          kind: "placeholder",
          message: "Review workflow completed without running an AI reviewer.",
        },
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(reviewRun.id, run.id))
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown review workflow error"

    await db
      .update(reviewRun)
      .set({
        status: "failed",
        error: message,
        updatedAt: new Date(),
      })
      .where(eq(reviewRun.id, run.id))

    helpers.logger.error("Failed to review pull request", {
      reviewRunId: run.id,
      pullRequestId: run.pullRequestId,
      headSha: run.headSha,
      error,
    })

    throw error
  }
}
