import { db } from "../../db/client"
import { env } from "../../env"
import { jobs } from "../../jobs/definitions"
import { docSourceConfigs } from "./sources"

type Logger = {
  info: (message: string, details?: Record<string, unknown>) => void
}

export const enqueueDueDocSourceCrawls = async ({
  logger,
  force = false,
}: {
  logger: Logger
  force?: boolean
}) => {
  const staleBefore = new Date(
    Date.now() - env.DOCS_RECRAWL_INTERVAL_HOURS * 3_600_000,
  )
  const sources = await db.query.docSource.findMany({
    columns: { slug: true, lastCrawledAt: true, status: true },
  })
  const stateBySlug = new Map(sources.map((source) => [source.slug, source]))

  const enqueued: string[] = []
  for (const config of docSourceConfigs) {
    const state = stateBySlug.get(config.slug)
    const due =
      force ||
      !state?.lastCrawledAt ||
      state.lastCrawledAt < staleBefore
    if (!due) continue
    await jobs.crawlDocSource.enqueue(db, { slug: config.slug })
    enqueued.push(config.slug)
  }

  logger.info("Docs recrawl sweep", {
    configured: docSourceConfigs.length,
    enqueued,
    intervalHours: env.DOCS_RECRAWL_INTERVAL_HOURS,
  })
  return enqueued
}

export const listDocSourcesWithState = async () => {
  const sources = await db.query.docSource.findMany()
  const stateBySlug = new Map(sources.map((source) => [source.slug, source]))

  return docSourceConfigs.map((config) => {
    const state = stateBySlug.get(config.slug)
    return {
      slug: config.slug,
      name: config.name,
      llmsTxtUrl: config.llmsTxtUrl,
      status: state?.status ?? "never_crawled",
      lastCrawledAt: state?.lastCrawledAt ?? null,
      lastError: state?.lastError ?? null,
      activePageCount: state?.activeCrawlId ? state.pageCount : 0,
    }
  })
}

export const enqueueDocSourceCrawl = async (slug: string) => {
  const config = docSourceConfigs.find((source) => source.slug === slug)
  if (!config) return false
  await jobs.crawlDocSource.enqueue(db, { slug })
  return true
}
