import {
  IdempotencyCollisionError,
  type BaseWorkflowDeclaration,
} from "@hatchet-dev/typescript-sdk/v1"
import { and, eq, isNull, lt, sql } from "drizzle-orm"
import { db } from "../db/client"
import { jobOutbox } from "../db/schema"

type ClaimedJob = {
  id: string
  job_name: string
  payload: Record<string, unknown>
  attempts: number
}

const MAX_ATTEMPTS = 10
const PUBLISHED_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1_000

const claimJobs = async () =>
  db.transaction(async (tx) => {
    const result = await tx.execute(sql<ClaimedJob>`
      with jobs as (
        select id
        from job_outbox
        where published_at is null
          and failed_at is null
          and available_at <= now()
          and (locked_at is null or locked_at < now() - interval '5 minutes')
        order by created_at
        limit 20
        for update skip locked
      )
      update job_outbox
      set locked_at = now(),
          attempts = job_outbox.attempts + 1,
          updated_at = now()
      from jobs
      where job_outbox.id = jobs.id
      returning job_outbox.id,
                job_outbox.job_name,
                job_outbox.payload,
                job_outbox.attempts
    `)
    return result.rows as unknown as ClaimedJob[]
  })

const markPublished = (id: string, hatchetRunId: string) =>
  db
    .update(jobOutbox)
    .set({
      publishedAt: new Date(),
      lockedAt: null,
      hatchetRunId,
      lastError: null,
    })
    .where(and(eq(jobOutbox.id, id), isNull(jobOutbox.publishedAt)))

const releaseJob = async (job: ClaimedJob, error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  if (job.attempts >= MAX_ATTEMPTS) {
    await db
      .update(jobOutbox)
      .set({ lockedAt: null, failedAt: new Date(), lastError: message })
      .where(and(eq(jobOutbox.id, job.id), isNull(jobOutbox.publishedAt)))
    console.error("Outbox job reached its attempt limit", {
      outboxId: job.id,
      jobName: job.job_name,
      attempts: job.attempts,
      error: message,
    })
    return
  }

  const delaySeconds = Math.min(300, 2 ** Math.min(job.attempts, 8))
  await db
    .update(jobOutbox)
    .set({
      lockedAt: null,
      availableAt: new Date(Date.now() + delaySeconds * 1_000),
      lastError: message,
    })
    .where(and(eq(jobOutbox.id, job.id), isNull(jobOutbox.publishedAt)))
}

const deleteExpiredPublishedJobs = () =>
  db
    .delete(jobOutbox)
    .where(
      lt(jobOutbox.publishedAt, new Date(Date.now() - PUBLISHED_RETENTION_MS))
    )

const waitFor = (durationMs: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, durationMs)
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout)
        resolve()
      },
      { once: true }
    )
  })

export const dispatchOutbox = async (
  workflows: Record<string, BaseWorkflowDeclaration<any, any>>,
  signal: AbortSignal
) => {
  let nextCleanupAt = 0
  let failureCount = 0

  while (!signal.aborted) {
    try {
      if (Date.now() >= nextCleanupAt) {
        await deleteExpiredPublishedJobs()
        nextCleanupAt = Date.now() + CLEANUP_INTERVAL_MS
      }

      const jobs = await claimJobs()
      failureCount = 0
      if (jobs.length === 0) {
        await waitFor(1_000, signal)
        continue
      }

      await Promise.all(
        jobs.map(async (job) => {
          try {
            const workflow = workflows[job.job_name]
            if (!workflow) throw new Error(`Unknown job name: ${job.job_name}`)

            let hatchetRunId: string
            try {
              const ref = await workflow.runNoWait({
                ...job.payload,
                dispatchId: job.id,
              })
              hatchetRunId = await ref.getWorkflowRunId()
            } catch (error) {
              if (!(error instanceof IdempotencyCollisionError)) throw error
              hatchetRunId = error.existingRunExternalId
            }

            await markPublished(job.id, hatchetRunId)
          } catch (error) {
            console.error("Failed to dispatch outbox job", {
              outboxId: job.id,
              jobName: job.job_name,
              error,
            })
            try {
              await releaseJob(job, error)
            } catch (releaseError) {
              console.error("Failed to release outbox job", {
                outboxId: job.id,
                jobName: job.job_name,
                error: releaseError,
              })
            }
          }
        })
      )
    } catch (error) {
      failureCount += 1
      console.error("Outbox dispatcher failed; it will retry", {
        failureCount,
        error,
      })
      const delayMs = Math.min(
        30_000,
        1_000 * 2 ** Math.min(failureCount - 1, 5)
      )
      await waitFor(delayMs, signal)
    }
  }
}
