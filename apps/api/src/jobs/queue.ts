import { sql, type SQL } from "drizzle-orm"

export type JobExecutor = {
  execute: (query: SQL) => Promise<unknown>
}

export const enqueueJob = (
  executor: JobExecutor,
  identifier: string,
  payload: Record<string, unknown>,
  options: {
    jobKey?: string
    maxAttempts?: number
  } = {},
) =>
  executor.execute(sql`
    select graphile_worker.add_job(
      ${identifier},
      ${JSON.stringify(payload)}::json,
      job_key := ${options.jobKey ?? null},
      max_attempts := ${options.maxAttempts ?? null}
    )
  `)
