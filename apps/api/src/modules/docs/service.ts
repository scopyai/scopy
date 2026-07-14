import { randomUUID } from "node:crypto"
import { and, asc, eq, isNull } from "drizzle-orm"
import { db } from "../../db/client"
import { docSource, repository } from "../../db/schema"
import { env } from "../../env"
import { jobs } from "../../jobs/definitions"
import { detectDocLibraries } from "./detect-libraries"
import { checkUrlIsPublic } from "./safe-url"
import { docSourceConfigs } from "./sources"

type Logger = {
  info: (message: string, details?: Record<string, unknown>) => void
}

export const MAX_CUSTOM_SOURCES_PER_WORKSPACE = 10

const upsertGlobalSource = async (config: (typeof docSourceConfigs)[number]) =>
  db
    .insert(docSource)
    .values({
      id: randomUUID(),
      slug: config.slug,
      name: config.name,
      llmsTxtUrl: config.llmsTxtUrl,
    })
    .onConflictDoUpdate({
      target: [docSource.slug],
      targetWhere: isNull(docSource.workspaceId),
      set: {
        name: config.name,
        llmsTxtUrl: config.llmsTxtUrl,
        updatedAt: new Date(),
      },
    })
    .returning()
    .then(([source]) => {
      if (!source) throw new Error(`Failed to upsert doc source ${config.slug}`)
      return source
    })

export const enqueueDueDocSourceCrawls = async ({
  logger,
  force = false,
}: {
  logger: Logger
  force?: boolean
}) => {
  for (const config of docSourceConfigs) {
    await upsertGlobalSource(config)
  }

  const staleBefore = new Date(
    Date.now() - env.DOCS_RECRAWL_INTERVAL_HOURS * 3_600_000
  )
  const sources = await db.query.docSource.findMany({
    columns: { id: true, slug: true, lastCrawledAt: true },
  })

  const enqueued: string[] = []
  for (const source of sources) {
    const due =
      force || !source.lastCrawledAt || source.lastCrawledAt < staleBefore
    if (!due) continue
    await jobs.crawlDocSource.enqueue(db, { sourceId: source.id })
    enqueued.push(source.slug)
  }

  logger.info("Docs recrawl sweep", {
    total: sources.length,
    enqueued,
    intervalHours: env.DOCS_RECRAWL_INTERVAL_HOURS,
  })
  return enqueued
}

const selectSourceState = (source: typeof docSource.$inferSelect) => ({
  id: source.id,
  slug: source.slug,
  name: source.name,
  llmsTxtUrl: source.llmsTxtUrl,
  status: source.status,
  lastCrawledAt: source.lastCrawledAt,
  lastError: source.lastError,
  activePageCount: source.activeCrawlId ? source.pageCount : 0,
})

export const listDocSourcesWithState = async () => {
  const sources = await db.query.docSource.findMany({
    where: isNull(docSource.workspaceId),
    orderBy: [asc(docSource.slug)],
  })
  const stateBySlug = new Map(sources.map((source) => [source.slug, source]))

  return docSourceConfigs.map((config) => {
    const state = stateBySlug.get(config.slug)
    return state
      ? selectSourceState(state)
      : {
          id: null,
          slug: config.slug,
          name: config.name,
          llmsTxtUrl: config.llmsTxtUrl,
          status: "never_crawled" as const,
          lastCrawledAt: null,
          lastError: null,
          activePageCount: 0,
        }
  })
}

export const enqueueDocSourceCrawl = async (slug: string) => {
  const config = docSourceConfigs.find((source) => source.slug === slug)
  if (!config) return false
  const source = await upsertGlobalSource(config)
  await jobs.crawlDocSource.enqueue(db, { sourceId: source.id })
  return true
}

export const refreshRepositoryDocLibraries = async ({
  repositoryId,
  repoDir,
}: {
  repositoryId: string
  repoDir: string
}) => {
  const detected = await detectDocLibraries(repoDir)
  await db
    .update(repository)
    .set({
      detectedDocLibraries: detected,
      docLibrariesDetectedAt: new Date(),
    })
    .where(eq(repository.id, repositoryId))
  return detected
}

// --- Workspace-owned custom sources ---

const slugify = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)

const normalizeDocUrl = (url: string) => {
  try {
    const parsed = new URL(url)
    return `${parsed.hostname.toLowerCase()}${parsed.pathname.replace(/\/+$/, "")}`
  } catch {
    return url.trim().toLowerCase()
  }
}

export const listWorkspaceDocSources = async (workspaceId: string) => {
  const sources = await db.query.docSource.findMany({
    where: eq(docSource.workspaceId, workspaceId),
    orderBy: [asc(docSource.name)],
  })
  return sources.map(selectSourceState)
}

export const createWorkspaceDocSource = async ({
  workspaceId,
  name,
  llmsTxtUrl,
}: {
  workspaceId: string
  name: string
  llmsTxtUrl: string
}): Promise<
  | { ok: true; source: ReturnType<typeof selectSourceState> }
  | { ok: false; error: string }
> => {
  const builtIn = docSourceConfigs.find(
    (config) => normalizeDocUrl(config.llmsTxtUrl) === normalizeDocUrl(llmsTxtUrl)
  )
  if (builtIn) {
    return {
      ok: false,
      error: `${builtIn.name} documentation is already included by default`,
    }
  }

  const unsafe = await checkUrlIsPublic(llmsTxtUrl)
  if (unsafe) return { ok: false, error: `URL rejected: ${unsafe}` }

  const slug = slugify(name)
  if (!slug) return { ok: false, error: "Name must contain letters or digits" }

  const existing = await db.query.docSource.findMany({
    columns: { slug: true, llmsTxtUrl: true },
    where: eq(docSource.workspaceId, workspaceId),
  })
  if (existing.length >= MAX_CUSTOM_SOURCES_PER_WORKSPACE) {
    return {
      ok: false,
      error: `Limit of ${MAX_CUSTOM_SOURCES_PER_WORKSPACE} custom doc sources reached`,
    }
  }
  if (existing.some((source) => source.slug === slug)) {
    return { ok: false, error: "A doc source with this name already exists" }
  }
  if (
    existing.some(
      (source) => normalizeDocUrl(source.llmsTxtUrl) === normalizeDocUrl(llmsTxtUrl)
    )
  ) {
    return { ok: false, error: "A doc source with this URL already exists" }
  }

  const [source] = await db
    .insert(docSource)
    .values({
      id: randomUUID(),
      workspaceId,
      slug,
      name: name.trim(),
      llmsTxtUrl,
    })
    .returning()
  await jobs.crawlDocSource.enqueue(db, { sourceId: source!.id })
  return { ok: true, source: selectSourceState(source!) }
}

export const deleteWorkspaceDocSource = async ({
  workspaceId,
  sourceId,
}: {
  workspaceId: string
  sourceId: string
}) => {
  const [removed] = await db
    .delete(docSource)
    .where(
      and(eq(docSource.id, sourceId), eq(docSource.workspaceId, workspaceId))
    )
    .returning({ id: docSource.id })
  return Boolean(removed)
}

export const enqueueWorkspaceDocSourceCrawl = async ({
  workspaceId,
  sourceId,
}: {
  workspaceId: string
  sourceId: string
}) => {
  const source = await db.query.docSource.findFirst({
    columns: { id: true },
    where: and(
      eq(docSource.id, sourceId),
      eq(docSource.workspaceId, workspaceId)
    ),
  })
  if (!source) return false
  await jobs.crawlDocSource.enqueue(db, { sourceId: source.id })
  return true
}
