import { randomUUID } from "node:crypto"
import { eq, inArray } from "drizzle-orm"
import { db, pool } from "./client"
import { reviewRun, reviewUsage } from "./schema"
import { flattenBillingModels } from "../modules/billing/usage"

/**
 * One-off, idempotent backfill: populates `review_usage` from the billing
 * breakdown already stored on every completed `review_run.result`. Historical
 * reviews all predate BYOK, so they are recorded as platform-billed. Safe to
 * run multiple times — inserts skip rows that already exist.
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const numberAt = (record: Record<string, unknown>, key: string) => {
  const value = record[key]
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

const stringAt = (record: Record<string, unknown>, key: string, fallback: string) => {
  const value = record[key]
  return typeof value === "string" && value.length > 0 ? value : fallback
}

const run = async () => {
  console.log("Backfilling review_usage from review_run results")

  const runs = await db.query.reviewRun.findMany({
    where: eq(reviewRun.status, "completed"),
    with: {
      pullRequest: {
        with: { repository: true },
      },
    },
  })

  const runIds = runs.map((row) => row.id)
  if (runIds.length === 0) {
    console.log("No completed reviews to backfill")
    return
  }

  const existing = await db
    .select({ reviewRunId: reviewUsage.reviewRunId })
    .from(reviewUsage)
    .where(inArray(reviewUsage.reviewRunId, runIds))
  const alreadyRecorded = new Set(existing.map((row) => row.reviewRunId))

  let inserted = 0
  let skipped = 0

  for (const reviewRunRow of runs) {
    if (alreadyRecorded.has(reviewRunRow.id)) {
      skipped += 1
      continue
    }
    const result = reviewRunRow.result
    if (!isRecord(result) || !isRecord(result.billing)) {
      skipped += 1
      continue
    }
    const billing = result.billing
    const repositoryRow = reviewRunRow.pullRequest?.repository
    const workspaceId = repositoryRow?.workspaceId
    if (!workspaceId) {
      skipped += 1
      continue
    }

    const llm = isRecord(billing.llm) ? billing.llm : {}

    await db
      .insert(reviewUsage)
      .values({
        id: randomUUID(),
        reviewRunId: reviewRunRow.id,
        workspaceId,
        repositoryId: repositoryRow?.id ?? null,
        pullRequestId: reviewRunRow.pullRequestId,
        billingMode: "platform",
        provider: null,
        providerKeyId: null,
        keyPreview: null,
        balanceAfter: null,
        modelId: stringAt(result, "modelId", "unknown"),
        verifierModelId: stringAt(result, "verifierModelId", "unknown"),
        llmCostMicrocents: numberAt(billing, "llmCostMicrocents"),
        vectorWriteCostMicrocents: numberAt(billing, "vectorWriteCostMicrocents"),
        vectorQueryCostMicrocents: numberAt(billing, "vectorQueryCostMicrocents"),
        vectorNetworkCostMicrocents: numberAt(
          billing,
          "vectorNetworkCostMicrocents",
        ),
        totalCostMicrocents: numberAt(billing, "totalCostMicrocents"),
        vectorWriteBytes: numberAt(billing, "vectorWriteBytes"),
        vectorQueryBytes: numberAt(billing, "vectorQueryBytes"),
        vectorNetworkBytes: numberAt(billing, "vectorNetworkBytes"),
        vectorQueryCount: numberAt(billing, "vectorQueryCount"),
        models: flattenBillingModels(llm),
        createdAt: reviewRunRow.completedAt ?? reviewRunRow.createdAt,
      })
      .onConflictDoNothing({ target: reviewUsage.reviewRunId })

    inserted += 1
  }

  console.log(
    `Backfill complete: ${inserted} inserted, ${skipped} skipped (of ${runs.length} completed reviews)`,
  )
}

try {
  await run()
} finally {
  await pool.end()
}
