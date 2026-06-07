import { createHash } from "node:crypto"
import { QdrantClient } from "@qdrant/js-client-rest"
import {
  buildRepositoryCodeIndex,
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
  signature?: string
  parameters?: string[]
  returnType?: string
  startLine: number
  endLine: number
  content: string
  strategy: "scope" | "scope-window" | "file-fallback"
  parentName?: string
  parentKind?: Exclude<ScopeDefinition["kind"], "top-level">
  parentStartLine?: number
  parentEndLine?: number
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
  indexedLogicalBytes?: number
  limit?: number
}

export type SearchReviewCodeOutput = {
  chunks: Array<ReviewCodeChunk & { score: number }>
  markdown: string
  stats: {
    chunks: number
    bytes: number
    queryBytes: number
    originalQueryBytes: number
    queryTruncated: boolean
    queriedBytes: number
    returnedBytes: number
    queryUnits: number
  }
}

const MAX_CHUNK_BYTES = 60 * 1024
const MAX_CHUNK_LINES = 400
const SCOPE_WINDOW_LINES = 220
const SCOPE_WINDOW_OVERLAP_LINES = 40
const MAX_SEARCH_QUERY_CHARS = 1_500

const normalizeSearchQuery = (query: string) => {
  const withoutDiffPrefixes = query
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-+ ](?=[^\s])/, ""))
    .join(" ")
  const normalized = withoutDiffPrefixes.replace(/\s+/g, " ").trim()
  const shortened = normalized.slice(0, MAX_SEARCH_QUERY_CHARS)
  const text = shortened || query.trim().slice(0, MAX_SEARCH_QUERY_CHARS)
  return {
    text,
    originalBytes: Buffer.byteLength(query, "utf8"),
    bytes: Buffer.byteLength(text, "utf8"),
    truncated: text.length < query.trim().length,
  }
}

const hash = (value: string) => createHash("sha256").update(value).digest("hex")

const pointId = (chunk: Omit<CodeChunk, "id">) => {
  const idHash = hash(
    [
      chunk.repositoryKey,
      chunk.file,
      chunk.kind,
      chunk.name,
      chunk.startLine,
      chunk.endLine,
      chunk.strategy,
      chunk.parentName ?? "",
      chunk.parentKind ?? "",
      chunk.parentStartLine ?? "",
      chunk.parentEndLine ?? "",
      hash(chunk.content),
    ].join("\0")
  )
  return [
    idHash.slice(0, 8),
    idHash.slice(8, 12),
    `4${idHash.slice(13, 16)}`,
    `${((Number.parseInt(idHash.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${idHash.slice(18, 20)}`,
    idHash.slice(20, 32),
  ].join("-")
}

const logicalVectorBytes = (
  chunk: ReviewCodeChunk,
  vectorSize: number,
) =>
  Buffer.byteLength(chunk.content, "utf8") +
  Buffer.byteLength(JSON.stringify(chunk), "utf8") +
  vectorSize * 4

const fileChunkFor = ({
  repositoryKey,
  file,
  language,
  source,
}: {
  repositoryKey: string
  file: string
  language: string
  source: string
}): CodeChunk | undefined => {
  const lines = source.split(/\r?\n/)
  const content = lines.slice(0, MAX_CHUNK_LINES).join("\n")
  if (Buffer.byteLength(content, "utf8") > MAX_CHUNK_BYTES) return undefined
  const chunk = {
    repositoryKey,
    file,
    language,
    kind: "file" as const,
    name: file,
    startLine: 1,
    endLine: Math.min(lines.length, MAX_CHUNK_LINES),
    content,
    strategy: "file-fallback" as const,
  }
  return { ...chunk, id: pointId(chunk) }
}

const boundedLineSlice = (
  source: string,
  startLine: number,
  endLine: number,
) => {
  const lines = source.split(/\r?\n/)
  const selected = lines.slice(startLine - 1, endLine)
  let content = selected.join("\n")
  let safeEndLine = endLine
  while (
    Buffer.byteLength(content, "utf8") > MAX_CHUNK_BYTES &&
    selected.length > 1
  ) {
    selected.pop()
    safeEndLine -= 1
    content = selected.join("\n")
  }
  if (Buffer.byteLength(content, "utf8") > MAX_CHUNK_BYTES) return undefined
  return { content, endLine: safeEndLine }
}

const scopeChunksFor = ({
  repositoryKey,
  file,
  language,
  source,
  scope,
}: {
  repositoryKey: string
  file: string
  language: string
  source: string
  scope: ScopeDefinition
}): CodeChunk[] => {
  if (scope.kind === "top-level") return []
  const scopeKind = scope.kind as Exclude<ScopeDefinition["kind"], "top-level">
  const lines = scope.endLine - scope.startLine + 1
  const wholeScope = boundedLineSlice(source, scope.startLine, scope.endLine)

  if (
    wholeScope &&
    lines <= MAX_CHUNK_LINES &&
    wholeScope.endLine === scope.endLine
  ) {
    const chunk = {
      repositoryKey,
      file,
      language,
      kind: scopeKind,
      name: scope.name,
      signature: scope.signature,
      parameters: scope.parameters,
      returnType: scope.returnType,
      startLine: scope.startLine,
      endLine: scope.endLine,
      content: wholeScope.content,
      strategy: "scope" as const,
    }
    return [{ ...chunk, id: pointId(chunk) }]
  }

  const chunks: CodeChunk[] = []
  const step = SCOPE_WINDOW_LINES - SCOPE_WINDOW_OVERLAP_LINES
  let startLine = scope.startLine
  let part = 1

  while (startLine <= scope.endLine) {
    const requestedEndLine = Math.min(
      scope.endLine,
      startLine + SCOPE_WINDOW_LINES - 1,
    )
    const window = boundedLineSlice(source, startLine, requestedEndLine)
    if (!window) break
    const chunk = {
      repositoryKey,
      file,
      language,
      kind: scopeKind,
      name: `${scope.name} part ${part}`,
      signature: scope.signature,
      parameters: scope.parameters,
      returnType: scope.returnType,
      startLine,
      endLine: window.endLine,
      content: window.content,
      strategy: "scope-window" as const,
      parentName: scope.name,
      parentKind: scopeKind,
      parentStartLine: scope.startLine,
      parentEndLine: scope.endLine,
    }
    chunks.push({ ...chunk, id: pointId(chunk) })
    if (requestedEndLine >= scope.endLine) break
    startLine = Math.max(window.endLine + 1, startLine + step)
    part += 1
  }

  return chunks
}

const qdrantClient = ({ client, url, apiKey }: QdrantConfig) => {
  if (client) return client
  if (!url)
    throw new Error("Qdrant url is required when client is not provided")
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
  field: string
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
  collection: string
) => {
  await Promise.all(
    ["repositoryId", "headSha", "reviewRunId"].map((field) =>
      ensurePayloadIndex(client, collection, field)
    )
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
    const scopedChunks: CodeChunk[] = []

    for (const scope of file.scopes) {
      scopedChunks.push(
        ...scopeChunksFor({
          repositoryKey,
          file: file.path,
          language: file.language,
          source,
          scope,
        }),
      )
    }
    if (scopedChunks.length > 0) {
      chunks.push(...scopedChunks)
    } else {
      const fileChunk = fileChunkFor({
        repositoryKey,
        file: file.path,
        language: file.language,
        source,
      })
      if (fileChunk) chunks.push(fileChunk)
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
    const scopedChunks: CodeChunk[] = []

    for (const scope of file.scopes) {
      scopedChunks.push(
        ...scopeChunksFor({
          repositoryKey,
          file: file.path,
          language: file.language,
          source,
          scope,
        }),
      )
    }
    if (scopedChunks.length > 0) {
      chunks.push(...scopedChunks)
    } else {
      const fileChunk = fileChunkFor({
        repositoryKey,
        file: file.path,
        language: file.language,
        source,
      })
      if (fileChunk) chunks.push(fileChunk)
    }
  }

  return chunks
}

const chunkText = (chunk: CodeChunk) =>
  [
    chunk.signature
      ? `${chunk.kind} ${chunk.signature}`
      : `${chunk.kind} ${chunk.name}`,
    chunk.parameters?.length ? `parameters ${chunk.parameters.join(", ")}` : "",
    chunk.returnType ? `returns ${chunk.returnType}` : "",
    `chunk strategy ${chunk.strategy}`,
    chunk.parentName
      ? `parent ${chunk.parentKind} ${chunk.parentName} ${chunk.parentStartLine}-${chunk.parentEndLine}`
      : "",
    `file ${chunk.file}`,
    `language ${chunk.language}`,
    chunk.content,
  ].filter(Boolean).join("\n")

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
      filter: {
        must: [{ key: "repositoryKey", match: { value: repositoryKey } }],
      },
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
            symbol.signature ? `signature ${symbol.signature}` : "",
            symbol.parameters?.length
              ? `parameters ${symbol.parameters.join(", ")}`
              : "",
            symbol.returnType ? `returns ${symbol.returnType}` : "",
            `file ${file.file}`,
            symbol.source,
            file.patch,
          ].join("\n"),
        }))
      : [
          {
            file: file.file,
            text: [`file ${file.file}`, file.patch].join("\n"),
          },
        ]
  )

const affectedKeys = (diffContext: DiffContextResult) =>
  new Set(
    diffContext.files.flatMap((file) => [
      `${file.file}:file`,
      ...file.affectedSymbols.map(
        (symbol) => `${symbol.file}:${symbol.startLine}:${symbol.endLine}`
      ),
    ])
  )

const renderSemanticMarkdown = ({
  repositoryKey,
  collection,
  chunks,
}: {
  repositoryKey: string
  collection: string
  chunks: Array<CodeChunk & { score: number }>
}) =>
  [
    "# Semantic Context",
    "",
    `Repository key: ${repositoryKey}`,
    `Collection: ${collection}`,
    `Chunks: ${chunks.length}`,
    "",
    ...chunks.flatMap((chunk) => [
      `## ${chunk.kind} ${chunk.name}`,
      "",
      chunk.signature ? `Definition: ${chunk.signature}` : "",
      chunk.parameters?.length
        ? `Parameters: ${chunk.parameters.join(", ")}`
        : "",
      chunk.returnType ? `Returns: ${chunk.returnType}` : "",
      `Score: ${chunk.score.toFixed(4)}`,
      `Location: ${chunk.file}:${chunk.startLine}-${chunk.endLine}`,
      chunk.parentName
        ? `Parent: ${chunk.parentKind} ${chunk.parentName} ${chunk.parentStartLine}-${chunk.parentEndLine}`
        : "",
      "",
      "```text",
      chunk.content,
      "```",
      "",
    ]),
  ].join("\n")

const MAX_SEARCH_RESULT_PREVIEW_LINES = 40
const MAX_SEARCH_RESULT_PREVIEW_BYTES = 8 * 1024
const MAX_SEARCH_MARKDOWN_BYTES = 50 * 1024

const previewContent = (content: string) => {
  const lines = content.split(/\r?\n/)
  let preview = lines.slice(0, MAX_SEARCH_RESULT_PREVIEW_LINES).join("\n")
  let truncated = lines.length > MAX_SEARCH_RESULT_PREVIEW_LINES

  while (
    Buffer.byteLength(preview, "utf8") > MAX_SEARCH_RESULT_PREVIEW_BYTES &&
    preview.length > 0
  ) {
    preview = preview.slice(0, Math.floor(preview.length * 0.9))
    truncated = true
  }

  return { preview, truncated }
}

const renderSearchMarkdown = (
  chunks: Array<ReviewCodeChunk & { score: number }>
) => {
  const render = (selectedChunks: Array<ReviewCodeChunk & { score: number }>) =>
    [
      "# Code Search Results",
      "",
      `Chunks: ${selectedChunks.length}`,
      "",
      ...selectedChunks.flatMap((chunk, index) => {
        const { preview, truncated } = previewContent(chunk.content)
        return [
          `## ${index + 1}. ${chunk.kind} ${chunk.name}`,
          "",
          chunk.signature ? `Definition: ${chunk.signature}` : "",
          chunk.parameters?.length
            ? `Parameters: ${chunk.parameters.join(", ")}`
            : "",
          chunk.returnType ? `Returns: ${chunk.returnType}` : "",
          `Location: ${chunk.file}:${chunk.startLine}-${chunk.endLine}`,
          chunk.parentName
            ? `Parent: ${chunk.parentKind} ${chunk.parentName} ${chunk.parentStartLine}-${chunk.parentEndLine}`
            : "",
          `Score: ${chunk.score.toFixed(4)}`,
          "",
          "```text",
          preview,
          truncated ? "[preview truncated]" : "",
          "```",
          "",
        ]
      }),
    ].join("\n")

  let selectedChunks = chunks
  let markdown = render(selectedChunks)
  while (
    Buffer.byteLength(markdown, "utf8") > MAX_SEARCH_MARKDOWN_BYTES &&
    selectedChunks.length > 1
  ) {
    selectedChunks = selectedChunks.slice(0, selectedChunks.length - 1)
    markdown = render(selectedChunks)
  }
  return markdown
}

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
  await client.delete(qdrant.collection, {
    wait: true,
    filter: filterByRun({ repositoryId, headSha, reviewRunId }),
  })

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
    })
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
    indexedFiles: new Set(chunks.map((chunk) => chunk.file)).size,
    ignoredFiles: index.ignoredFiles.length,
    logicalWriteBytes: chunks.reduce(
      (total, chunk) => total + logicalVectorBytes(chunk, qdrant.vectorSize),
      0
    ),
  }
}

export const searchReviewCode = async ({
  repositoryId,
  headSha,
  reviewRunId,
  query,
  qdrant,
  indexedLogicalBytes = 0,
  limit = 5,
}: SearchReviewCodeInput): Promise<SearchReviewCodeOutput> => {
  const client = qdrantClient(qdrant)
  const normalizedQuery = normalizeSearchQuery(query)
  const result = await client.query(qdrant.collection, {
    query: {
      text: normalizedQuery.text,
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
  const returnedBytes = Buffer.byteLength(markdown, "utf8")

  return {
    chunks,
    markdown,
    stats: {
      chunks: chunks.length,
      bytes: returnedBytes,
      queryBytes: normalizedQuery.bytes,
      originalQueryBytes: normalizedQuery.originalBytes,
      queryTruncated: normalizedQuery.truncated,
      queriedBytes: indexedLogicalBytes,
      returnedBytes,
      queryUnits: 1,
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
  limit = 5,
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
        if (skip.has(`${chunk.file}:${chunk.startLine}:${chunk.endLine}`))
          continue
        if (!chunks.has(chunk.id))
          chunks.set(chunk.id, { ...chunk, score: point.score })
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
          0
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
