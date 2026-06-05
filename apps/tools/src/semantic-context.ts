import { createHash } from "node:crypto"
import { QdrantClient } from "@qdrant/js-client-rest"
import {
  buildRepositoryCodeIndex,
  lineSlice,
  type RepositoryCodeIndex,
} from "./code-index"
import { buildDiffContext, type DiffContextResult } from "./diff/context"
import { parseUnifiedDiff } from "./diff/parse"
import { prepareRepository } from "./repository"
import type { Diagnostic, ScopeDefinition } from "./types"

export type CodeChunk = {
  id: string
  repositoryKey: string
  file: string
  language: string
  kind: "file" | Exclude<ScopeDefinition["kind"], "top-level">
  name: string
  startLine: number
  endLine: number
  content: string
}

export type ReviewCodeChunk = CodeChunk & {
  repositoryId: string
  headSha: string
  reviewRunId: string
}

export type EmbedTexts = (texts: string[]) => Promise<number[][]>

export type QdrantConfig = {
  client?: QdrantClient
  url?: string
  apiKey?: string
  collection: string
  vectorSize: number
}

export type QdrantInferenceConfig = QdrantConfig & {
  model: string
}

export type IndexCodebaseInput = {
  repository: string
  repositoryKey: string
  ref?: string
  qdrant: QdrantConfig
  embed: EmbedTexts
  keepTemporaryRepository?: boolean
}

export type IndexCodebaseOutput = {
  repositoryPath: string
  repositoryKey: string
  collection: string
  chunks: number
  files: number
  diagnostics: Diagnostic[]
}

export type GetSemanticContextInput = {
  repository: string
  repositoryKey: string
  ref?: string
  diff: string
  qdrant: QdrantConfig
  embed: EmbedTexts
  limit?: number
  keepTemporaryRepository?: boolean
}

export type SemanticContextResult = {
  repositoryPath: string
  repositoryKey: string
  collection: string
  diffContext: DiffContextResult
  chunks: Array<CodeChunk & { score: number }>
  markdown: string
  stats: {
    affectedSymbols: number
    chunks: number
    diagnostics: number
    bytes: number
  }
}

export type IndexReviewCodebaseInput = {
  index: RepositoryCodeIndex
  repositoryId: string
  repositoryKey: string
  headSha: string
  reviewRunId: string
  qdrant: QdrantInferenceConfig
}

export type SearchReviewCodeInput = {
  repositoryId: string
  headSha: string
  reviewRunId: string
  query: string
  qdrant: QdrantInferenceConfig
  limit?: number
}

export type SearchReviewCodeOutput = {
  chunks: Array<ReviewCodeChunk & { score: number }>
  markdown: string
  stats: {
    chunks: number
    bytes: number
  }
}

const hash = (value: string) => createHash("sha256").update(value).digest("hex")

const pointId = (chunk: Omit<CodeChunk, "id">) => {
  const idHash = hash([
    chunk.repositoryKey,
    chunk.file,
    chunk.kind,
    chunk.name,
    chunk.startLine,
    chunk.endLine,
    hash(chunk.content),
  ].join("\0"))
  return [
    idHash.slice(0, 8),
    idHash.slice(8, 12),
    `4${idHash.slice(13, 16)}`,
    `${((Number.parseInt(idHash.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${idHash.slice(18, 20)}`,
    idHash.slice(20, 32),
  ].join("-")
}

const qdrantClient = ({ client, url, apiKey }: QdrantConfig) => {
  if (client) return client
  if (!url) throw new Error("Qdrant url is required when client is not provided")
  return new QdrantClient({ url, apiKey })
}

const ensureCollection = async (client: QdrantClient, config: QdrantConfig) => {
  try {
    await client.getCollection(config.collection)
  } catch (error) {
    if (!(error instanceof Error) || !/404|not found/i.test(error.message)) {
      throw error
    }
    await client.createCollection(config.collection, {
      vectors: { size: config.vectorSize, distance: "Cosine" },
    })
  }
}

const ensurePayloadIndex = async (
  client: QdrantClient,
  collection: string,
  field: string,
) => {
  try {
    await client.createPayloadIndex(collection, {
      wait: true,
      field_name: field,
      field_schema: "keyword",
    })
  } catch (error) {
    if (
      error instanceof Error &&
      /already exists|same params|already has/i.test(error.message)
    ) {
      return
    }
    throw error
  }
}

const ensureReviewPayloadIndexes = async (
  client: QdrantClient,
  collection: string,
) => {
  await Promise.all(
    ["repositoryId", "headSha", "reviewRunId"].map((field) =>
      ensurePayloadIndex(client, collection, field),
    ),
  )
}

const filterByRun = ({
  repositoryId,
  headSha,
  reviewRunId,
}: {
  repositoryId: string
  headSha: string
  reviewRunId: string
}) => ({
  must: [
    { key: "repositoryId", match: { value: repositoryId } },
    { key: "headSha", match: { value: headSha } },
    { key: "reviewRunId", match: { value: reviewRunId } },
  ],
})

const chunksForRepository = async ({
  repository,
  repositoryKey,
}: {
  repository: string
  repositoryKey: string
}) => {
  const index = await buildRepositoryCodeIndex({ repository })
  const chunks: CodeChunk[] = []

  for (const file of index.files) {
    const source = index.sourceByFile.get(file.path)
    if (!source) continue
    const fileChunk = {
      repositoryKey,
      file: file.path,
      language: file.language,
      kind: "file" as const,
      name: file.path,
      startLine: 1,
      endLine: source.split(/\r?\n/).length,
      content: source,
    }
    chunks.push({ ...fileChunk, id: pointId(fileChunk) })

    for (const scope of file.scopes) {
      if (scope.kind === "top-level") continue
      const scopeChunk = {
        repositoryKey,
        file: file.path,
        language: file.language,
        kind: scope.kind as CodeChunk["kind"],
        name: scope.name,
        startLine: scope.startLine,
        endLine: scope.endLine,
        content: lineSlice(source, scope.startLine, scope.endLine),
      }
      chunks.push({ ...scopeChunk, id: pointId(scopeChunk) })
    }
  }

  return { index, chunks }
}

export const chunksForRepositoryIndex = ({
  index,
  repositoryKey,
}: {
  index: RepositoryCodeIndex
  repositoryKey: string
}) => {
  const chunks: CodeChunk[] = []

  for (const file of index.files) {
    const source = index.sourceByFile.get(file.path)
    if (!source) continue
    const fileChunk = {
      repositoryKey,
      file: file.path,
      language: file.language,
      kind: "file" as const,
      name: file.path,
      startLine: 1,
      endLine: source.split(/\r?\n/).length,
      content: source,
    }
    chunks.push({ ...fileChunk, id: pointId(fileChunk) })

    for (const scope of file.scopes) {
      if (scope.kind === "top-level") continue
      const scopeChunk = {
        repositoryKey,
        file: file.path,
        language: file.language,
        kind: scope.kind as CodeChunk["kind"],
        name: scope.name,
        startLine: scope.startLine,
        endLine: scope.endLine,
        content: lineSlice(source, scope.startLine, scope.endLine),
      }
      chunks.push({ ...scopeChunk, id: pointId(scopeChunk) })
    }
  }

  return chunks
}

const chunkText = (chunk: CodeChunk) =>
  [
    `${chunk.kind} ${chunk.name}`,
    `file ${chunk.file}`,
    `language ${chunk.language}`,
    chunk.content,
  ].join("\n")

export const indexCodebase = async ({
  repository,
  repositoryKey,
  ref,
  qdrant,
  embed,
  keepTemporaryRepository = false,
}: IndexCodebaseInput): Promise<IndexCodebaseOutput> => {
  const prepared = await prepareRepository({ repository, ref })
  try {
    const client = qdrantClient(qdrant)
    await ensureCollection(client, qdrant)
    await client.delete(qdrant.collection, {
      wait: true,
      filter: { must: [{ key: "repositoryKey", match: { value: repositoryKey } }] },
    })

    const { index, chunks } = await chunksForRepository({
      repository: prepared.path,
      repositoryKey,
    })
    const vectors = await embed(chunks.map(chunkText))
    await client.upsert(qdrant.collection, {
      wait: true,
      points: chunks.map((chunk, index) => ({
        id: chunk.id,
        vector: vectors[index]!,
        payload: chunk,
      })),
    })

    return {
      repositoryPath: prepared.path,
      repositoryKey,
      collection: qdrant.collection,
      chunks: chunks.length,
      files: index.files.length,
      diagnostics: index.diagnostics,
    }
  } finally {
    if (!keepTemporaryRepository) await prepared.cleanup()
  }
}

const queriesForDiff = (diffContext: DiffContextResult) =>
  diffContext.files.flatMap((file) =>
    file.affectedSymbols.length > 0
      ? file.affectedSymbols.map((symbol) => ({
          file: file.file,
          text: [
            `${symbol.kind} ${symbol.name}`,
            `file ${file.file}`,
            symbol.source,
            file.patch,
          ].join("\n"),
        }))
      : [{ file: file.file, text: [`file ${file.file}`, file.patch].join("\n") }],
  )

const affectedKeys = (diffContext: DiffContextResult) =>
  new Set(
    diffContext.files.flatMap((file) => [
      `${file.file}:file`,
      ...file.affectedSymbols.map((symbol) =>
        `${symbol.file}:${symbol.startLine}:${symbol.endLine}`,
      ),
    ]),
  )

const renderSemanticMarkdown = ({
  repositoryKey,
  collection,
  chunks,
}: {
  repositoryKey: string
  collection: string
  chunks: Array<CodeChunk & { score: number }>
}) => [
  "# Semantic Context",
  "",
  `Repository key: ${repositoryKey}`,
  `Collection: ${collection}`,
  `Chunks: ${chunks.length}`,
  "",
  ...chunks.flatMap((chunk) => [
    `## ${chunk.kind} ${chunk.name}`,
    "",
    `Score: ${chunk.score.toFixed(4)}`,
    `Location: ${chunk.file}:${chunk.startLine}-${chunk.endLine}`,
    "",
    "```text",
    chunk.content,
    "```",
    "",
  ]),
].join("\n")

const renderSearchMarkdown = (chunks: Array<ReviewCodeChunk & { score: number }>) =>
  [
    "# Code Search Results",
    "",
    `Chunks: ${chunks.length}`,
    "",
    ...chunks.flatMap((chunk) => [
      `## ${chunk.kind} ${chunk.name}`,
      "",
      `Score: ${chunk.score.toFixed(4)}`,
      `Location: ${chunk.file}:${chunk.startLine}-${chunk.endLine}`,
      "",
      "```text",
      chunk.content,
      "```",
      "",
    ]),
  ].join("\n")

const isCodeChunk = (payload: unknown): payload is CodeChunk => {
  if (!payload || typeof payload !== "object") return false
  const chunk = payload as Partial<CodeChunk>
  return Boolean(chunk.id && chunk.repositoryKey && chunk.file && chunk.content)
}

const isReviewCodeChunk = (payload: unknown): payload is ReviewCodeChunk => {
  if (!isCodeChunk(payload)) return false
  const chunk = payload as Partial<ReviewCodeChunk>
  return Boolean(chunk.repositoryId && chunk.headSha && chunk.reviewRunId)
}

export const indexReviewCodebase = async ({
  index,
  repositoryId,
  repositoryKey,
  headSha,
  reviewRunId,
  qdrant,
}: IndexReviewCodebaseInput) => {
  const client = qdrantClient(qdrant)
  await ensureCollection(client, qdrant)
  await ensureReviewPayloadIndexes(client, qdrant.collection)

  const chunks = chunksForRepositoryIndex({ index, repositoryKey }).map(
    (chunk): ReviewCodeChunk => ({
      ...chunk,
      id: pointId({
        ...chunk,
        repositoryKey: `${repositoryKey}:${reviewRunId}`,
      }),
      repositoryId,
      headSha,
      reviewRunId,
    }),
  )

  await client.upsert(qdrant.collection, {
    wait: true,
    points: chunks.map((chunk) => ({
      id: chunk.id,
      vector: {
        text: chunkText(chunk),
        model: qdrant.model,
      },
      payload: chunk,
    })),
  } as Parameters<typeof client.upsert>[1])

  return {
    collection: qdrant.collection,
    chunks: chunks.length,
  }
}

export const searchReviewCode = async ({
  repositoryId,
  headSha,
  reviewRunId,
  query,
  qdrant,
  limit = 10,
}: SearchReviewCodeInput): Promise<SearchReviewCodeOutput> => {
  const client = qdrantClient(qdrant)
  const result = await client.query(qdrant.collection, {
    query: {
      text: query,
      model: qdrant.model,
    },
    limit,
    with_payload: true,
    filter: filterByRun({ repositoryId, headSha, reviewRunId }),
  } as Parameters<typeof client.query>[1])
  const chunks = result.points
    .filter((point) => isReviewCodeChunk(point.payload))
    .map((point) => ({
      ...(point.payload as ReviewCodeChunk),
      score: point.score,
    }))
  const markdown = renderSearchMarkdown(chunks)

  return {
    chunks,
    markdown,
    stats: {
      chunks: chunks.length,
      bytes: Buffer.byteLength(markdown, "utf8"),
    },
  }
}

export const getSemanticContext = async ({
  repository,
  repositoryKey,
  ref,
  diff,
  qdrant,
  embed,
  limit = 10,
  keepTemporaryRepository = false,
}: GetSemanticContextInput): Promise<SemanticContextResult> => {
  const prepared = await prepareRepository({ repository, ref })
  try {
    const client = qdrantClient(qdrant)
    const diffContext = await buildDiffContext({
      repository: prepared.path,
      diffFiles: parseUnifiedDiff(diff),
    })
    const skip = affectedKeys(diffContext)
    const chunks = new Map<string, CodeChunk & { score: number }>()

    for (const query of queriesForDiff(diffContext)) {
      const [vector] = await embed([query.text])
      const points = await client.search(qdrant.collection, {
        vector: vector!,
        limit,
        with_payload: true,
        filter: {
          must: [{ key: "repositoryKey", match: { value: repositoryKey } }],
        },
      })

      for (const point of points) {
        if (!isCodeChunk(point.payload)) continue
        const chunk = point.payload
        if (skip.has(`${chunk.file}:file`)) continue
        if (skip.has(`${chunk.file}:${chunk.startLine}:${chunk.endLine}`)) continue
        if (!chunks.has(chunk.id)) chunks.set(chunk.id, { ...chunk, score: point.score })
        if (chunks.size >= limit) break
      }
      if (chunks.size >= limit) break
    }

    const resultChunks = [...chunks.values()]
    const markdown = renderSemanticMarkdown({
      repositoryKey,
      collection: qdrant.collection,
      chunks: resultChunks,
    })

    return {
      repositoryPath: prepared.path,
      repositoryKey,
      collection: qdrant.collection,
      diffContext,
      chunks: resultChunks,
      markdown,
      stats: {
        affectedSymbols: diffContext.files.reduce(
          (total, file) => total + file.affectedSymbols.length,
          0,
        ),
        chunks: resultChunks.length,
        diagnostics: diffContext.diagnostics.length,
        bytes: Buffer.byteLength(markdown, "utf8"),
      },
    }
  } finally {
    if (!keepTemporaryRepository) await prepared.cleanup()
  }
}
