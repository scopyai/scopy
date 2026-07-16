import { and, asc, eq } from "drizzle-orm"
import { Output, ToolLoopAgent, stepCountIs, tool } from "ai"
import { z } from "zod"
import { db } from "../../db/client"
import { docChunk, docPage } from "../../db/schema"
import { workerEnv as env } from "../../env"
import { createReviewLlm, repairedJsonOutput } from "../reviews/llm"
import { resolveDocSource, searchDocSourceChunks } from "./search"

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

const librarianInstructions = `You are a documentation librarian. You answer one question about a specific library using ONLY its indexed documentation.

You are given the documentation table of contents. Use tools to read pages or search page content, then answer.

Rules:
- Base every claim on documentation you actually read via tools in this conversation. Never answer from prior knowledge.
- Prefer search_docs for exact API names, config keys, or error strings; it returns matching sections with their heading — pass that url and heading to read_doc_page to read the section. Use read_doc_page without heading only when the table of contents already points at the right page.
- Cite every page you relied on: exact url, page title, and a short verbatim excerpt supporting the answer.
- If the documentation does not answer the question, return found: false and say what is missing. Do not guess.
- Distinguish documented absence from absence of documentation. State that something is NOT the case only when a document explicitly says so; when the pages you read simply do not address the question, say "the documentation I read does not address X" - never phrase your own unsuccessful search as a documented "no". The consumer treats these very differently: one refutes a claim, the other merely leaves it unverified.
- Keep the answer compact and factual; it will be consumed by another automated reviewer.`

export const queryDocsLibrarian = async (
  {
    library,
    question,
    workspaceId,
  }: {
    library: string
    question: string
    workspaceId?: string
  },
  options: LibrarianOptions = {}
): Promise<LibrarianResult> => {
  const source = await resolveDocSource(library, workspaceId)
  if (!source) {
    return {
      library,
      found: false,
      answer: `No documentation indexed for "${library}".`,
      citations: [],
    }
  }
  if (!source.activeCrawlId) {
    return {
      library: source.slug,
      found: false,
      answer: `Documentation for "${source.name}" is registered but not crawled yet.`,
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
          columns: { id: true, title: true },
          where: activePage(url),
        })
        if (!page) return { error: "no page stored for this url" }
        const chunks = await db.query.docChunk.findMany({
          columns: { ord: true, heading: true, contentMd: true },
          where: eq(docChunk.pageId, page.id),
          orderBy: [asc(docChunk.ord)],
        })
        if (heading) {
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
        }
        return {
          title: page.title,
          content: toolText(
            chunks.map((chunk) => chunk.contentMd).join("\n\n")
          ),
        }
      },
    }),
    search_docs: tool({
      description:
        "Full-text search across all documentation sections of this library. Best for exact API names, method signatures, config keys, and error strings. Returns matching sections (url + heading + snippet); pass url and heading to read_doc_page to read a section in full.",
      inputSchema: z.object({
        query: z.string().min(1),
      }),
      execute: async ({ query }) => {
        const results = await searchDocSourceChunks({
          sourceId: source.id,
          activeCrawlId,
          query,
        })
        if (results.length === 0) {
          return { results: [], note: "no matches; try different terms" }
        }
        return { results }
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
    prompt: `Library: ${source.name} (${source.slug})

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
    library: source.slug,
    ...output,
    usage: generation.totalUsage,
    generation,
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
        }
      : {}),
  }
}
