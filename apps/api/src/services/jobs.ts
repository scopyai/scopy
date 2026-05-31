import { sql, type SQL } from "drizzle-orm"

export type JobExecutor = {
  execute: (query: SQL) => Promise<unknown>
}

export const enqueueJob = (
  executor: JobExecutor,
  identifier: string,
  payload: Record<string, unknown>,
) =>
  executor.execute(sql`
    select graphile_worker.add_job(
      ${identifier},
      ${JSON.stringify(payload)}::json
    )
  `)
