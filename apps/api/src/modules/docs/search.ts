import { and, desc, eq, isNull, sql } from "drizzle-orm"
import { db } from "../../db/client"
import { docChunk, docPage, docSource } from "../../db/schema"
import { resolveDocSourceConfig } from "./sources"

export type DocSearchHit = {
  url: string
  title: string
  heading: string | null
  snippet: string
}

export const resolveDocSource = async (
  library: string,
  workspaceId?: string
) => {
  const normalized = library.trim().toLowerCase()
  if (!normalized) return null

  if (workspaceId) {
    const workspaceSources = await db.query.docSource.findMany({
      where: eq(docSource.workspaceId, workspaceId),
    })
    const match = workspaceSources.find(
      (source) =>
        source.slug === normalized || source.name.toLowerCase() === normalized
    )
    if (match) return match
  }

  const config = resolveDocSourceConfig(library)
  if (!config) return null
  return (
    (await db.query.docSource.findFirst({
      where: and(
        eq(docSource.slug, config.slug),
        isNull(docSource.workspaceId)
      ),
    })) ?? null
  )
}

export const searchDocSourceChunks = async ({
  sourceId,
  activeCrawlId,
  query,
  limit = 12,
  maxFragments = 2,
  maxWords = 40,
}: {
  sourceId: string
  activeCrawlId: string
  query: string
  limit?: number
  maxFragments?: number
  maxWords?: number
}): Promise<DocSearchHit[]> => {
  const headlineOptions = `MaxFragments=${maxFragments}, MaxWords=${maxWords}, MinWords=10`
  const searchChunks = (tsQuery: ReturnType<typeof sql>) =>
    db
      .select({
        url: docPage.url,
        title: docPage.title,
        heading: docChunk.heading,
        snippet: sql<string>`ts_headline('english', ${docChunk.contentMd}, ${tsQuery}, ${headlineOptions})`,
        rank: sql<number>`ts_rank(${docChunk.contentTsv}, ${tsQuery})`,
      })
      .from(docChunk)
      .innerJoin(docPage, eq(docChunk.pageId, docPage.id))
      .where(
        and(
          eq(docChunk.sourceId, sourceId),
          eq(docPage.lastSeenCrawlId, activeCrawlId),
          sql`${docChunk.contentTsv} @@ ${tsQuery}`
        )
      )
      .orderBy((table) => desc(table.rank))
      .limit(limit)

  let results = await searchChunks(
    sql`websearch_to_tsquery('english', ${query})`
  )
  if (results.length === 0) {
    const orQuery = query
      .split(/[^\p{L}\p{N}_.]+/u)
      .filter((term) => term.length > 1)
      .map((term) => term.replace(/'/g, ""))
      .join(" or ")
    if (orQuery) {
      results = await searchChunks(
        sql`websearch_to_tsquery('english', ${orQuery})`
      )
    }
  }
  return results.map(({ url, title, heading, snippet }) => ({
    url,
    title,
    heading,
    snippet,
  }))
}
