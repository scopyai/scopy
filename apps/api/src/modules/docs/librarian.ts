import { and, asc, desc, eq, sql } from "drizzle-orm"
import { Output, ToolLoopAgent, stepCountIs, tool } from "ai"
import { z } from "zod"
import { db } from "../../db/client"
import { docChunk, docPage, docSource } from "../../db/schema"
import { env } from "../../env"
import { createReviewLlm, repairedJsonOutput } from "../reviews/llm"
import { resolveDocSourceConfig } from "./sources"

const MAX_TOC_ENTRIES = 500
const MAX_TOOL_BYTES = 20_000
const MAX_STEPS = 8

const librarianOutputSchema = z.object({
  found: z.boolean(),
  answer: z.string().min(1),
  citations: z.array(
    z.object({
      url: z.string().min(1),
      title: z.string().min(1),
      excerpt: z.string().min(1),
    })
  ),
})

export type LibrarianStepDiagnostics = {
  finishReason: string
  usage: unknown
  toolCalls: { name: string; input: unknown }[]
}

export type LibrarianDiagnostics = {
  modelId: string
  stepCount: number
  toolCallCount: number
  durationMs: number
  steps: LibrarianStepDiagnostics[]
}

export type LibrarianResult = z.infer<typeof librarianOutputSchema> & {
  library: string
  usage?: unknown
  diagnostics?: LibrarianDiagnostics
  generation?: unknown
}

export type LibrarianOptions = {
  diagnostics?: boolean
}

const toolText = (text: string, maxBytes = MAX_TOOL_BYTES) => {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text
  let output = text
  while (Buffer.byteLength(output, "utf8") > maxBytes) {
    output = output.slice(0, Math.floor(output.length * 0.9))
  }
  return `${output}\n\n[truncated]`
}

const sliceHeadingSection = (markdown: string, heading: string) => {
  const lines = markdown.split("\n")
  const target = heading.trim().toLowerCase()
  let startIndex = -1
  let startLevel = 0
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index]?.match(/^(#{1,6})\s+(.*)$/)
    if (!match?.[1] || !match[2]) continue
    if (startIndex === -1) {
      if (match[2].trim().toLowerCase().includes(target)) {
        startIndex = index
        startLevel = match[1].length
      }
      continue
    }
    if (match[1].length <= startLevel) {
      return lines.slice(startIndex, index).join("\n")
    }
  }
  if (startIndex === -1) return null
  return lines.slice(startIndex).join("\n")
}

const librarianInstructions = `You are a documentation librarian. You answer one question about a specific library using ONLY its indexed documentation.

You are given the documentation table of contents. Use tools to read pages or search page content, then answer.

Rules:
- Base every claim on documentation you actually read via tools in this conversation. Never answer from prior knowledge.
- Prefer search_docs for exact API names, config keys, or error strings; it returns matching sections with their heading — pass that url and heading to read_doc_page to read the section. Use read_doc_page without heading only when the table of contents already points at the right page.
- Cite every page you relied on: exact url, page title, and a short verbatim excerpt supporting the answer.
- If the documentation does not answer the question, return found: false and say what is missing. Do not guess.
- Keep the answer compact and factual; it will be consumed by another automated reviewer.`

export const queryDocsLibrarian = async (
  {
    library,
    question,
  }: {
    library: string
    question: string
  },
  options: LibrarianOptions = {}
): Promise<LibrarianResult> => {
  const config = resolveDocSourceConfig(library)
  if (!config) {
    return {
      library,
      found: false,
      answer: `No documentation indexed for "${library}".`,
      citations: [],
    }
  }

  const source = await db.query.docSource.findFirst({
    where: eq(docSource.slug, config.slug),
  })
  if (!source?.activeCrawlId) {
    return {
      library: config.slug,
      found: false,
      answer: `Documentation for "${config.name}" is registered but not crawled yet.`,
      citations: [],
    }
  }
  const activeCrawlId = source.activeCrawlId
  const tocEntries = (source.toc ?? []).slice(0, MAX_TOC_ENTRIES)

  const activePage = (url: string) =>
    and(
      eq(docPage.sourceId, source.id),
      eq(docPage.lastSeenCrawlId, activeCrawlId),
      eq(docPage.url, url)
    )

  const tools = {
    read_doc_page: tool({
      description:
        "Returns documentation content by exact url from the table of contents or search results. Pass the heading from a search result to get that section plus its neighbors; omit heading for the whole page.",
      inputSchema: z.object({
        url: z.string().min(1),
        heading: z.string().min(1).optional(),
      }),
      execute: async ({ url, heading }) => {
        const page = await db.query.docPage.findFirst({
          columns: { id: true, title: true, contentMd: true },
          where: activePage(url),
        })
        if (!page) return { error: "no page stored for this url" }
        if (heading) {
          const chunks = await db.query.docChunk.findMany({
            columns: { ord: true, heading: true, contentMd: true },
            where: eq(docChunk.pageId, page.id),
            orderBy: [asc(docChunk.ord)],
          })
          const target = heading.trim().toLowerCase()
          const matchIndex = chunks.findIndex((chunk) =>
            chunk.heading?.toLowerCase().includes(target)
          )
          if (matchIndex !== -1) {
            const window = chunks.slice(
              Math.max(0, matchIndex - 1),
              matchIndex + 2
            )
            return {
              title: page.title,
              heading: chunks[matchIndex]!.heading,
              content: toolText(
                window.map((chunk) => chunk.contentMd).join("\n\n")
              ),
            }
          }
          const section = sliceHeadingSection(page.contentMd, heading)
          if (section) {
            return { title: page.title, heading, content: toolText(section) }
          }
        }
        return { title: page.title, content: toolText(page.contentMd) }
      },
    }),
    search_docs: tool({
      description:
        "Full-text search across all documentation sections of this library. Best for exact API names, method signatures, config keys, and error strings. Returns matching sections (url + heading + snippet); pass url and heading to read_doc_page to read a section in full.",
      inputSchema: z.object({
        query: z.string().min(1),
      }),
      execute: async ({ query }) => {
        const searchChunks = (tsQuery: ReturnType<typeof sql>) =>
          db
            .select({
              url: docPage.url,
              title: docPage.title,
              heading: docChunk.heading,
              snippet: sql<string>`ts_headline('english', ${docChunk.contentMd}, ${tsQuery}, 'MaxFragments=2, MaxWords=40, MinWords=10')`,
              rank: sql<number>`ts_rank(to_tsvector('english', ${docChunk.contentMd}), ${tsQuery})`,
            })
            .from(docChunk)
            .innerJoin(docPage, eq(docChunk.pageId, docPage.id))
            .where(
              and(
                eq(docChunk.sourceId, source.id),
                eq(docPage.lastSeenCrawlId, activeCrawlId),
                sql`to_tsvector('english', ${docChunk.contentMd}) @@ ${tsQuery}`
              )
            )
            .orderBy((table) => desc(table.rank))
            .limit(12)

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
        if (results.length === 0) {
          return { results: [], note: "no matches; try different terms" }
        }
        return {
          results: results.map(({ url, title, heading, snippet }) => ({
            url,
            title,
            heading,
            snippet,
          })),
        }
      },
    }),
  }

  const toc = tocEntries
    .map(
      (entry) =>
        `${entry.section ? `[${entry.section}] ` : ""}${entry.title} — ${entry.url}${entry.description ? ` — ${entry.description}` : ""}`
    )
    .join("\n")

  const llm = createReviewLlm()
  const modelId = env.DOCS_LIBRARIAN_MODEL ?? env.REVIEW_VERIFIER_MODEL
  const steps: LibrarianStepDiagnostics[] = []
  const agent = new ToolLoopAgent({
    model: llm.chatModel(modelId),
    instructions: librarianInstructions,
    tools,
    providerOptions: llm.providerOptionsFor(modelId, "low"),
    output: repairedJsonOutput(
      Output.object({
        schema: librarianOutputSchema,
        name: "librarian_answer",
        description: "Documentation answer with citations",
      })
    ),
    stopWhen: stepCountIs(MAX_STEPS),
    maxRetries: 2,
    ...(options.diagnostics
      ? {
          onStepFinish: async (step) => {
            steps.push({
              finishReason: step.finishReason,
              usage: step.usage,
              toolCalls: step.toolCalls.map((call) => ({
                name: call.toolName,
                input: call.input,
              })),
            })
          },
        }
      : {}),
  })

  const startedAt = Date.now()
  const generation = await agent.generate({
    prompt: `Library: ${config.name} (${config.slug})

Documentation table of contents:
${toc}

Question: ${question}`,
  })
  let output: z.infer<typeof librarianOutputSchema>
  try {
    output = librarianOutputSchema.parse(generation.output)
  } catch {
    output = {
      found: false,
      answer:
        "The librarian ran out of its step budget before producing an answer.",
      citations: [],
    }
  }

  return {
    library: config.slug,
    ...output,
    usage: generation.totalUsage,
    ...(options.diagnostics
      ? {
          diagnostics: {
            modelId,
            stepCount: steps.length,
            toolCallCount: steps.reduce(
              (total, step) => total + step.toolCalls.length,
              0
            ),
            durationMs: Date.now() - startedAt,
            steps,
          },
          generation,
        }
      : {}),
  }
}
