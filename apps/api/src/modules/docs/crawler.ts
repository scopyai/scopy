import { createHash, randomUUID } from "node:crypto"
import * as cheerio from "cheerio"
import { and, eq } from "drizzle-orm"
import TurndownService from "turndown"
import { db } from "../../db/client"
import { docChunk, docPage, docSource } from "../../db/schema"
import { chunkMarkdown } from "./chunker"
import { docSourceConfigs, type DocSourceConfig } from "./sources"

type Logger = {
  info: (message: string, details?: Record<string, unknown>) => void
  error: (message: string, details?: Record<string, unknown>) => void
}

const USER_AGENT = "scopy-docs-crawler/1.0 (+https://scopy.dev)"
const FETCH_TIMEOUT_MS = 15_000
const FETCH_RETRIES = 4
const PAGE_CONCURRENCY = 4
const MAX_RAW_BYTES = 2_000_000
const MAX_MARKDOWN_BYTES = 200_000
const DB_BATCH_SIZE = 50

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex")

const approxTokens = (text: string) => Math.ceil(text.length / 4)

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const fetchText = async (url: string) => {
  let lastError: unknown
  for (let attempt = 0; attempt <= FETCH_RETRIES; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          "user-agent": USER_AGENT,
          accept: "*/*",
        },
        redirect: "follow",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      if (response.status === 429 || response.status >= 500) {
        lastError = new Error(`HTTP ${response.status} for ${url}`)
        const retryAfterSeconds = Number(response.headers.get("retry-after"))
        const backoffMs =
          response.status === 429
            ? Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
              ? Math.min(retryAfterSeconds * 1000, 30_000)
              : Math.min(2000 * 2 ** attempt, 30_000)
            : 1000 * (attempt + 1)
        await sleep(backoffMs)
        continue
      }
      if (!response.ok) {
        return { ok: false as const, error: `HTTP ${response.status}` }
      }
      const contentType = response.headers.get("content-type") ?? ""
      if (
        contentType &&
        !/text\/|application\/(xhtml|xml|json)/i.test(contentType)
      ) {
        return { ok: false as const, error: `non-text content: ${contentType}` }
      }
      const text = await response.text()
      if (Buffer.byteLength(text, "utf8") > MAX_RAW_BYTES) {
        return { ok: false as const, error: "response exceeds size cap" }
      }
      return { ok: true as const, text, contentType }
    } catch (error) {
      lastError = error
      await sleep(1000 * (attempt + 1))
    }
  }
  return {
    ok: false as const,
    error: lastError instanceof Error ? lastError.message : String(lastError),
  }
}

export type ParsedIndexEntry = {
  section: string | null
  title: string
  url: string
  description: string | null
}

const LINK_LINE = /^[-*]?\s*\[([^\]]+)\]\(([^)\s]+)\)\s*(?::\s*(.*))?$/

const isFullDumpUrl = (url: string) =>
  /\/llms[-_.]?full\.txt$/i.test(new URL(url).pathname)

export const parseLlmsTxt = (
  text: string,
  baseUrl: string
): ParsedIndexEntry[] => {
  const entries: ParsedIndexEntry[] = []
  const seen = new Set<string>()
  let section: string | null = null

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim()
    if (!line) continue
    const heading = line.match(/^#{1,4}\s+(.*)$/)
    if (heading?.[1]) {
      section = heading[1].trim()
      continue
    }
    const link = line.match(LINK_LINE)
    if (!link?.[1] || !link[2]) continue
    let url: string
    try {
      url = new URL(link[2], baseUrl).toString()
    } catch {
      continue
    }
    if (!/^https?:/.test(url) || seen.has(url)) continue
    if (isFullDumpUrl(url) || url === new URL(baseUrl).toString()) continue
    seen.add(url)
    entries.push({
      section,
      title: link[1].trim(),
      url,
      description: link[3]?.trim() || null,
    })
  }
  return entries
}

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
})
turndown.remove(["script", "style", "nav", "header", "footer", "iframe"])

const htmlToMarkdown = (html: string) => {
  const $ = cheerio.load(html)
  const title = $("title").first().text().trim() || null
  const main = $("main").first()
  const article = $("article").first()
  const content = main.length
    ? $.html(main)
    : article.length
      ? $.html(article)
      : $.html($("body"))
  return { markdown: turndown.turndown(content), title }
}

const looksLikeHtml = (text: string, contentType: string) =>
  /html/i.test(contentType) || /^\s*<(!doctype|html)/i.test(text)

const runWithConcurrency = async <T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
) => {
  let cursor = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++
        const item = items[index]
        if (item !== undefined) await worker(item)
      }
    })
  )
}

type PageOutcome = "created" | "updated" | "unchanged" | "kept_stale" | "failed"

const upsertPage = async ({
  sourceId,
  crawlId,
  entry,
  markdown,
  title,
}: {
  sourceId: string
  crawlId: string
  entry: ParsedIndexEntry
  markdown: string
  title: string
}): Promise<PageOutcome> => {
  const contentHash = sha256(markdown)
  const existing = await db.query.docPage.findFirst({
    columns: { id: true, contentHash: true },
    where: and(eq(docPage.sourceId, sourceId), eq(docPage.url, entry.url)),
  })

  if (existing && existing.contentHash === contentHash) {
    await db
      .update(docPage)
      .set({ lastSeenCrawlId: crawlId })
      .where(eq(docPage.id, existing.id))
    // Chunks are the only copy of the page text; restore them if a chunker
    // change (or bug) wiped them, since we have the fetched markdown in hand.
    const [chunk] = await db
      .select({ id: docChunk.id })
      .from(docChunk)
      .where(eq(docChunk.pageId, existing.id))
      .limit(1)
    if (!chunk) await rebuildChunks({ sourceId, pageId: existing.id, markdown })
    return "unchanged"
  }

  if (existing) {
    await db
      .update(docPage)
      .set({
        title,
        contentHash,
        approxTokens: approxTokens(markdown),
        lastSeenCrawlId: crawlId,
        fetchedAt: new Date(),
      })
      .where(eq(docPage.id, existing.id))
    await rebuildChunks({ sourceId, pageId: existing.id, markdown })
    return "updated"
  }

  const pageId = randomUUID()
  await db.insert(docPage).values({
    id: pageId,
    sourceId,
    url: entry.url,
    title,
    contentHash,
    approxTokens: approxTokens(markdown),
    lastSeenCrawlId: crawlId,
    fetchedAt: new Date(),
  })
  await rebuildChunks({ sourceId, pageId, markdown })
  return "created"
}

const rebuildChunks = async ({
  sourceId,
  pageId,
  markdown,
}: {
  sourceId: string
  pageId: string
  markdown: string
}) => {
  const chunks = chunkMarkdown(markdown)
  await db.delete(docChunk).where(eq(docChunk.pageId, pageId))
  for (let i = 0; i < chunks.length; i += DB_BATCH_SIZE) {
    await db.insert(docChunk).values(
      chunks.slice(i, i + DB_BATCH_SIZE).map((chunk) => ({
        id: randomUUID(),
        sourceId,
        pageId,
        ord: chunk.ord,
        heading: chunk.heading,
        contentMd: chunk.contentMd,
        approxTokens: chunk.approxTokens,
      }))
    )
  }
  return chunks.length
}

const keepStalePage = async ({
  sourceId,
  crawlId,
  url,
}: {
  sourceId: string
  crawlId: string
  url: string
}) => {
  const updated = await db
    .update(docPage)
    .set({ lastSeenCrawlId: crawlId })
    .where(and(eq(docPage.sourceId, sourceId), eq(docPage.url, url)))
    .returning({ id: docPage.id })
  return updated.length > 0
}

const upsertSourceFromConfig = async (config: DocSourceConfig) => {
  const [source] = await db
    .insert(docSource)
    .values({
      id: randomUUID(),
      slug: config.slug,
      name: config.name,
      llmsTxtUrl: config.llmsTxtUrl,
      status: "crawling",
    })
    .onConflictDoUpdate({
      target: docSource.slug,
      set: {
        name: config.name,
        llmsTxtUrl: config.llmsTxtUrl,
        status: "crawling",
        updatedAt: new Date(),
      },
    })
    .returning()
  if (!source) throw new Error(`Failed to upsert doc source ${config.slug}`)
  return source
}

export const crawlDocSource = async ({
  slug,
  logger,
}: {
  slug: string
  logger: Logger
}) => {
  const config = docSourceConfigs.find((source) => source.slug === slug)
  if (!config) throw new Error(`Unknown doc source slug: ${slug}`)

  const source = await upsertSourceFromConfig(config)
  const crawlId = randomUUID()
  logger.info("Docs crawl started", { slug, crawlId })

  const failCrawl = async (error: string) => {
    await db
      .update(docSource)
      .set({ status: "error", lastError: error })
      .where(eq(docSource.id, source.id))
    logger.error("Docs crawl failed", { slug, crawlId, error })
    throw new Error(`Docs crawl failed for ${slug}: ${error}`)
  }

  const indexFetch = await fetchText(config.llmsTxtUrl)
  if (!indexFetch.ok) {
    return failCrawl(`llms.txt fetch failed: ${indexFetch.error}`)
  }
  let entries = parseLlmsTxt(indexFetch.text, config.llmsTxtUrl)
  if (entries.length === 0) {
    if (indexFetch.text.trim().length < 500) {
      return failCrawl("llms.txt contained no parseable links")
    }
    entries = [
      {
        section: null,
        title: config.name,
        url: config.llmsTxtUrl,
        description: null,
      },
    ]
    logger.info("Docs index is content-style; storing as single page", {
      slug,
    })
  } else {
    logger.info("Docs index parsed", { slug, entryCount: entries.length })
  }

  const outcomes: Record<PageOutcome, number> = {
    created: 0,
    updated: 0,
    unchanged: 0,
    kept_stale: 0,
    failed: 0,
  }

  await runWithConcurrency(entries, PAGE_CONCURRENCY, async (entry) => {
    const fetched = await fetchText(entry.url)
    if (!fetched.ok) {
      const kept = await keepStalePage({
        sourceId: source.id,
        crawlId,
        url: entry.url,
      })
      outcomes[kept ? "kept_stale" : "failed"] += 1
      if (!kept) {
        logger.info("Docs page fetch failed", {
          slug,
          url: entry.url,
          error: fetched.error,
        })
      }
      return
    }

    let markdown = fetched.text
    let title = entry.title
    if (looksLikeHtml(fetched.text, fetched.contentType)) {
      const converted = htmlToMarkdown(fetched.text)
      markdown = converted.markdown
      title = converted.title ?? entry.title
    }
    markdown = markdown.trim()
    if (!markdown) {
      outcomes.failed += 1
      return
    }
    if (Buffer.byteLength(markdown, "utf8") > MAX_MARKDOWN_BYTES) {
      let capped = markdown
      while (Buffer.byteLength(capped, "utf8") > MAX_MARKDOWN_BYTES) {
        capped = capped.slice(0, Math.floor(capped.length * 0.9))
      }
      markdown = `${capped}\n\n[truncated]`
    }

    outcomes[
      await upsertPage({
        sourceId: source.id,
        crawlId,
        entry,
        markdown,
        title,
      })
    ] += 1
  })

  const pageCount =
    outcomes.created +
    outcomes.updated +
    outcomes.unchanged +
    outcomes.kept_stale
  if (pageCount === 0) {
    return failCrawl("no pages could be fetched")
  }

  await db
    .update(docSource)
    .set({
      activeCrawlId: crawlId,
      toc: entries,
      pageCount,
      status: "idle",
      lastError: null,
      lastCrawledAt: new Date(),
    })
    .where(eq(docSource.id, source.id))

  logger.info("Docs crawl completed", { slug, crawlId, ...outcomes })
  return { crawlId, pageCount, outcomes }
}
