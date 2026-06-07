import { and, eq, gte, inArray, isNotNull, lte, sql } from "drizzle-orm"
import { db } from "../../db/client"
import {
  pullRequest,
  repository,
  reviewFinding,
  reviewRun,
  type ProviderActor,
} from "../../db/schema"

export const analyticsRangeValues = [
  "this_week",
  "this_month",
  "last_30_days",
  "last_90_days",
  "all_time",
] as const

export type AnalyticsRange = (typeof analyticsRangeValues)[number]

export class AnalyticsError extends Error {
  constructor(
    message: string,
    public readonly statusCode: 400 | 404 = 400,
  ) {
    super(message)
    this.name = "AnalyticsError"
  }
}

const severityValues = ["critical", "high", "medium", "low"] as const

const dateKey = (date: Date) => date.toISOString().slice(0, 10)

const startOfUtcDay = (date: Date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))

const startOfUtcWeek = (date: Date) => {
  const day = date.getUTCDay()
  const daysSinceMonday = day === 0 ? 6 : day - 1
  const start = startOfUtcDay(date)
  start.setUTCDate(start.getUTCDate() - daysSinceMonday)
  return start
}

const startOfUtcMonth = (date: Date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))

export const resolveAnalyticsWindow = (
  range: AnalyticsRange,
  now = new Date(),
) => {
  switch (range) {
    case "this_week":
      return { range, start: startOfUtcWeek(now), end: now }
    case "this_month":
      return { range, start: startOfUtcMonth(now), end: now }
    case "last_30_days": {
      const start = startOfUtcDay(now)
      start.setUTCDate(start.getUTCDate() - 29)
      return { range, start, end: now }
    }
    case "last_90_days": {
      const start = startOfUtcDay(now)
      start.setUTCDate(start.getUTCDate() - 89)
      return { range, start, end: now }
    }
    case "all_time":
      return { range, start: null, end: now }
  }
}

export const fillDailyBuckets = (
  rows: Array<{ date: string; count: number }>,
  start: Date | null,
  end: Date,
) => {
  const counts = new Map(rows.map((row) => [row.date, Number(row.count)]))

  if (!start) {
    return rows.map((row) => ({
      date: row.date,
      count: Number(row.count),
    }))
  }

  const items: Array<{ date: string; count: number }> = []
  const cursor = startOfUtcDay(start)
  const endDay = startOfUtcDay(end)

  while (cursor <= endDay) {
    const key = dateKey(cursor)
    items.push({ date: key, count: counts.get(key) ?? 0 })
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }

  return items
}

const parseNumber = (value: number | string | null | undefined) =>
  value == null ? 0 : Number(value)

const parseRepositoryIds = (repositoryIds: string | undefined) =>
  (repositoryIds ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)

const parseAuthorIds = (authorIds: string | undefined) =>
  (authorIds ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)

const getRepositoryFilter = async (
  workspaceId: string,
  repositoryIds: string | undefined,
) => {
  const selectedRepositoryIds = parseRepositoryIds(repositoryIds)
  if (selectedRepositoryIds.length === 0) {
    return { selectedRepositoryIds: null }
  }

  const uniqueIds = [...new Set(selectedRepositoryIds)]
  const rows = await db
    .select({ id: repository.id })
    .from(repository)
    .where(
      and(
        eq(repository.workspaceId, workspaceId),
        inArray(repository.id, uniqueIds),
      ),
    )

  if (rows.length !== uniqueIds.length) {
    throw new AnalyticsError("Invalid repository filter")
  }

  return { selectedRepositoryIds: uniqueIds }
}

const getAuthorFilter = (authorIds: string | undefined) => {
  const selectedAuthorIds = [...new Set(parseAuthorIds(authorIds))]
  return {
    selectedAuthorIds:
      selectedAuthorIds.length > 0 ? selectedAuthorIds : null,
  }
}

const withRepositoryFilter = (
  selectedRepositoryIds: string[] | null,
  conditions: Parameters<typeof and>,
) =>
  selectedRepositoryIds
    ? [...conditions, inArray(repository.id, selectedRepositoryIds)]
    : conditions

const withAuthorFilter = (
  selectedAuthorIds: string[] | null,
  conditions: Parameters<typeof and>,
) =>
  selectedAuthorIds
    ? [
        ...conditions,
        inArray(sql`${pullRequest.author}->>'id'`, selectedAuthorIds),
      ]
    : conditions

const withDateRange = <TColumn>(
  column: TColumn,
  start: Date | null,
  end: Date,
  conditions: Parameters<typeof and>,
) => {
  const next = [...conditions, lte(column as never, end)]
  if (start) next.push(gte(column as never, start))
  return next
}

const getCompletedReviewConditions = (
  workspaceId: string,
  selectedRepositoryIds: string[] | null,
  selectedAuthorIds: string[] | null,
  start: Date | null,
  end: Date,
) =>
  withDateRange(
    reviewRun.completedAt,
    start,
    end,
    withAuthorFilter(
      selectedAuthorIds,
      withRepositoryFilter(selectedRepositoryIds, [
        eq(repository.workspaceId, workspaceId),
        eq(reviewRun.status, "completed"),
        isNotNull(reviewRun.completedAt),
      ]),
    ),
  )

const getPullRequestConditions = (
  workspaceId: string,
  selectedRepositoryIds: string[] | null,
  selectedAuthorIds: string[] | null,
  start: Date | null,
  end: Date,
  dateColumn: typeof pullRequest.openedAt | typeof pullRequest.mergedAt,
) =>
  withDateRange(
    dateColumn,
    start,
    end,
    withAuthorFilter(
      selectedAuthorIds,
      withRepositoryFilter(selectedRepositoryIds, [
        eq(repository.workspaceId, workspaceId),
      ]),
    ),
  )

const getCompletedReviewRowsByDay = async (
  workspaceId: string,
  selectedRepositoryIds: string[] | null,
  selectedAuthorIds: string[] | null,
  start: Date | null,
  end: Date,
) =>
  db
    .select({
      date: sql<string>`to_char(date_trunc('day', ${reviewRun.completedAt}), 'YYYY-MM-DD')`,
      count: sql<number>`count(*)::int`,
    })
    .from(reviewRun)
    .innerJoin(pullRequest, eq(pullRequest.id, reviewRun.pullRequestId))
    .innerJoin(repository, eq(repository.id, pullRequest.repositoryId))
    .where(
      and(
        ...getCompletedReviewConditions(
          workspaceId,
          selectedRepositoryIds,
          selectedAuthorIds,
          start,
          end,
        ),
      ),
    )
    .groupBy(sql`date_trunc('day', ${reviewRun.completedAt})`)
    .orderBy(sql`date_trunc('day', ${reviewRun.completedAt})`)

const getFindingRowsByDay = async (
  workspaceId: string,
  selectedRepositoryIds: string[] | null,
  selectedAuthorIds: string[] | null,
  start: Date | null,
  end: Date,
) =>
  db
    .select({
      date: sql<string>`to_char(date_trunc('day', ${reviewRun.completedAt}), 'YYYY-MM-DD')`,
      count: sql<number>`count(*)::int`,
    })
    .from(reviewFinding)
    .innerJoin(reviewRun, eq(reviewRun.id, reviewFinding.reviewRunId))
    .innerJoin(pullRequest, eq(pullRequest.id, reviewRun.pullRequestId))
    .innerJoin(repository, eq(repository.id, pullRequest.repositoryId))
    .where(
      and(
        ...getCompletedReviewConditions(
          workspaceId,
          selectedRepositoryIds,
          selectedAuthorIds,
          start,
          end,
        ),
      ),
    )
    .groupBy(sql`date_trunc('day', ${reviewRun.completedAt})`)
    .orderBy(sql`date_trunc('day', ${reviewRun.completedAt})`)

const getPullRequestRowsByDay = async (
  workspaceId: string,
  selectedRepositoryIds: string[] | null,
  selectedAuthorIds: string[] | null,
  start: Date | null,
  end: Date,
) =>
  db
    .select({
      date: sql<string>`to_char(date_trunc('day', ${pullRequest.openedAt}), 'YYYY-MM-DD')`,
      count: sql<number>`count(*)::int`,
    })
    .from(pullRequest)
    .innerJoin(repository, eq(repository.id, pullRequest.repositoryId))
    .where(
      and(
        ...getPullRequestConditions(
          workspaceId,
          selectedRepositoryIds,
          selectedAuthorIds,
          start,
          end,
          pullRequest.openedAt,
        ),
      ),
    )
    .groupBy(sql`date_trunc('day', ${pullRequest.openedAt})`)
    .orderBy(sql`date_trunc('day', ${pullRequest.openedAt})`)

const getSummary = async (
  workspaceId: string,
  selectedRepositoryIds: string[] | null,
  selectedAuthorIds: string[] | null,
  start: Date | null,
  end: Date,
) => {
  const [reviewSummary] = await db
    .select({
      totalPrReviews: sql<number>`count(*)::int`,
      reviewedPrCount: sql<number>`count(distinct ${reviewRun.pullRequestId})::int`,
    })
    .from(reviewRun)
    .innerJoin(pullRequest, eq(pullRequest.id, reviewRun.pullRequestId))
    .innerJoin(repository, eq(repository.id, pullRequest.repositoryId))
    .where(
      and(
        ...getCompletedReviewConditions(
          workspaceId,
          selectedRepositoryIds,
          selectedAuthorIds,
          start,
          end,
        ),
      ),
    )

  const [findingSummary] = await db
    .select({
      bugsCaught: sql<number>`count(*)::int`,
    })
    .from(reviewFinding)
    .innerJoin(reviewRun, eq(reviewRun.id, reviewFinding.reviewRunId))
    .innerJoin(pullRequest, eq(pullRequest.id, reviewRun.pullRequestId))
    .innerJoin(repository, eq(repository.id, pullRequest.repositoryId))
    .where(
      and(
        ...getCompletedReviewConditions(
          workspaceId,
          selectedRepositoryIds,
          selectedAuthorIds,
          start,
          end,
        ),
      ),
    )

  const [mergeSummary] = await db
    .select({
      mergedPrCount: sql<number>`count(*)::int`,
      averageSeconds: sql<number | null>`avg(extract(epoch from (${pullRequest.mergedAt} - ${pullRequest.openedAt})))`,
    })
    .from(pullRequest)
    .innerJoin(repository, eq(repository.id, pullRequest.repositoryId))
    .where(
      and(
        ...getPullRequestConditions(
          workspaceId,
          selectedRepositoryIds,
          selectedAuthorIds,
          start,
          end,
          pullRequest.mergedAt,
        ),
        isNotNull(pullRequest.mergedAt),
      ),
    )

  const averageSeconds = parseNumber(mergeSummary?.averageSeconds)
  const mergedPrCount = parseNumber(mergeSummary?.mergedPrCount)

  return {
    totalPrReviews: parseNumber(reviewSummary?.totalPrReviews),
    reviewedPrCount: parseNumber(reviewSummary?.reviewedPrCount),
    bugsCaught: parseNumber(findingSummary?.bugsCaught),
    mergedPrCount,
    averageTimeToMergeHours:
      mergedPrCount > 0 ? Number((averageSeconds / 3600).toFixed(2)) : null,
    averageTimeToMergeDays:
      mergedPrCount > 0 ? Number((averageSeconds / 86400).toFixed(2)) : null,
  }
}

const getSeverityDistribution = async (
  workspaceId: string,
  selectedRepositoryIds: string[] | null,
  selectedAuthorIds: string[] | null,
  start: Date | null,
  end: Date,
) => {
  const rows = await db
    .select({
      severity: reviewFinding.severity,
      count: sql<number>`count(*)::int`,
    })
    .from(reviewFinding)
    .innerJoin(reviewRun, eq(reviewRun.id, reviewFinding.reviewRunId))
    .innerJoin(pullRequest, eq(pullRequest.id, reviewRun.pullRequestId))
    .innerJoin(repository, eq(repository.id, pullRequest.repositoryId))
    .where(
      and(
        ...getCompletedReviewConditions(
          workspaceId,
          selectedRepositoryIds,
          selectedAuthorIds,
          start,
          end,
        ),
      ),
    )
    .groupBy(reviewFinding.severity)

  const counts = new Map(rows.map((row) => [row.severity, Number(row.count)]))
  return severityValues.map((severity) => ({
    severity,
    count: counts.get(severity) ?? 0,
  }))
}

const getCodebaseHealth = async (
  workspaceId: string,
  selectedRepositoryIds: string[] | null,
  selectedAuthorIds: string[] | null,
  start: Date | null,
  end: Date,
) => {
  const conditions = getCompletedReviewConditions(
    workspaceId,
    selectedRepositoryIds,
    selectedAuthorIds,
    start,
    end,
  )

  const [mostFlaggedFiles, bugProneLanguages] = await Promise.all([
    db
      .select({
        repositoryId: repository.id,
        repositoryFullName: repository.fullName,
        file: reviewFinding.file,
        count: sql<number>`count(*)::int`,
      })
      .from(reviewFinding)
      .innerJoin(reviewRun, eq(reviewRun.id, reviewFinding.reviewRunId))
      .innerJoin(pullRequest, eq(pullRequest.id, reviewRun.pullRequestId))
      .innerJoin(repository, eq(repository.id, pullRequest.repositoryId))
      .where(and(...conditions))
      .groupBy(repository.id, repository.fullName, reviewFinding.file)
      .orderBy(sql`count(*) desc`, repository.fullName, reviewFinding.file)
      .limit(10),
    db
      .select({
        language: reviewFinding.language,
        count: sql<number>`count(*)::int`,
      })
      .from(reviewFinding)
      .innerJoin(reviewRun, eq(reviewRun.id, reviewFinding.reviewRunId))
      .innerJoin(pullRequest, eq(pullRequest.id, reviewRun.pullRequestId))
      .innerJoin(repository, eq(repository.id, pullRequest.repositoryId))
      .where(and(...conditions))
      .groupBy(reviewFinding.language)
      .orderBy(sql`count(*) desc`, reviewFinding.language)
      .limit(10),
  ])

  return {
    mostFlaggedFiles: mostFlaggedFiles.map((row) => ({
      ...row,
      count: Number(row.count),
    })),
    bugProneLanguages: bugProneLanguages.map((row) => ({
      ...row,
      count: Number(row.count),
    })),
  }
}

const getAvailableAuthors = async (
  workspaceId: string,
  selectedRepositoryIds: string[] | null,
) => {
  const rows = await db
    .select({ author: pullRequest.author })
    .from(pullRequest)
    .innerJoin(repository, eq(repository.id, pullRequest.repositoryId))
    .where(
      and(
        ...withRepositoryFilter(selectedRepositoryIds, [
          eq(repository.workspaceId, workspaceId),
          isNotNull(pullRequest.author),
        ]),
      ),
    )

  const authorsById = new Map<string, ProviderActor>()

  for (const row of rows) {
    const author = row.author
    if (!author?.id || !author.login) continue
    authorsById.set(author.id, author)
  }

  return [...authorsById.values()].sort((a, b) =>
    a.login.localeCompare(b.login),
  )
}

export const getWorkspaceAnalytics = async ({
  workspaceId,
  range,
  repositoryIds,
  authorIds,
  now = new Date(),
}: {
  workspaceId: string
  range: AnalyticsRange
  repositoryIds?: string
  authorIds?: string
  now?: Date
}) => {
  const { selectedRepositoryIds } = await getRepositoryFilter(
    workspaceId,
    repositoryIds,
  )
  const { selectedAuthorIds } = getAuthorFilter(authorIds)
  const window = resolveAnalyticsWindow(range, now)
  const { start, end } = window

  const [
    summary,
    prReviewRows,
    findingRows,
    pullRequestRows,
    severityDistribution,
    codebaseHealth,
    availableAuthors,
  ] = await Promise.all([
    getSummary(workspaceId, selectedRepositoryIds, selectedAuthorIds, start, end),
    getCompletedReviewRowsByDay(
      workspaceId,
      selectedRepositoryIds,
      selectedAuthorIds,
      start,
      end,
    ),
    getFindingRowsByDay(
      workspaceId,
      selectedRepositoryIds,
      selectedAuthorIds,
      start,
      end,
    ),
    getPullRequestRowsByDay(
      workspaceId,
      selectedRepositoryIds,
      selectedAuthorIds,
      start,
      end,
    ),
    getSeverityDistribution(
      workspaceId,
      selectedRepositoryIds,
      selectedAuthorIds,
      start,
      end,
    ),
    getCodebaseHealth(
      workspaceId,
      selectedRepositoryIds,
      selectedAuthorIds,
      start,
      end,
    ),
    getAvailableAuthors(workspaceId, selectedRepositoryIds),
  ])

  return {
    range,
    filters: {
      repositoryIds: selectedRepositoryIds ?? [],
      authorIds: selectedAuthorIds ?? [],
    },
    window: {
      start,
      end,
    },
    summary,
    prReviewsGraph: fillDailyBuckets(prReviewRows, start, end),
    bugsCaughtGraph: fillDailyBuckets(findingRows, start, end),
    severityDistribution,
    codebaseHealth,
    averageTimeToMerge: {
      hours: summary.averageTimeToMergeHours,
      days: summary.averageTimeToMergeDays,
      mergedPrCount: summary.mergedPrCount,
    },
    prHeatmap: fillDailyBuckets(pullRequestRows, start, end),
    availableAuthors,
  }
}
