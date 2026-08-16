import { createHash } from "node:crypto"
import { QdrantClient } from "@qdrant/js-client-rest"
import type { RepositoryCodeIndex } from "./code-index"
import type { ScopeDefinition } from "./types"

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

export type IndexReviewCodebaseInput = {
  index: RepositoryCodeIndex
  filePaths?: Iterable<string>
  chunks?: CodeChunk[]
  repositoryId: string
  repositoryKey: string
  headSha: string
  reviewRunId: string
  qdrant: QdrantInferenceConfig
  onProgress?: (progress: {
    status: "started" | "progress" | "completed"
    totalChunks: number
    writtenChunks: number
  }) => void
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

const logicalVectorBytes = (chunk: ReviewCodeChunk, vectorSize: number) =>
  Buffer.byteLength(chunk.content, "utf8") +
  Buffer.byteLength(JSON.stringify(chunk), "utf8") +
  vectorSize * 4

type IndexedSource = {
  lines: string[]
  prefixBytes: number[]
}

const indexSourceLines = (source: string): IndexedSource => {
  const lines = source.split(/\r?\n/)
  const prefixBytes = new Array<number>(lines.length + 1)
  prefixBytes[0] = 0
  for (let index = 0; index < lines.length; index += 1) {
    prefixBytes[index + 1] =
      prefixBytes[index]! + Buffer.byteLength(lines[index]!, "utf8") + 1
  }
  return { lines, prefixBytes }
}

const sliceBytes = (
  source: IndexedSource,
  startIndex: number,
  endIndex: number
) => source.prefixBytes[endIndex]! - source.prefixBytes[startIndex]! - 1

const fileChunkFor = ({
  repositoryKey,
  file,
  language,
  source,
}: {
  repositoryKey: string
  file: string
  language: string
  source: IndexedSource
}): CodeChunk | undefined => {
  const selected = boundedLineSlice(
    source,
    1,
    Math.min(source.lines.length, MAX_CHUNK_LINES)
  )
  if (!selected) return undefined
  const chunk = {
    repositoryKey,
    file,
    language,
    kind: "file" as const,
    name: file,
    startLine: 1,
    endLine: selected.endLine,
    content: selected.content,
    strategy: "file-fallback" as const,
  }
  return { ...chunk, id: pointId(chunk) }
}

const boundedLineSlice = (
  source: IndexedSource,
  startLine: number,
  endLine: number
) => {
  const startIndex = Math.max(0, startLine - 1)
  const requestedEndIndex = Math.min(source.lines.length, endLine)
  if (requestedEndIndex <= startIndex) return undefined
  if (sliceBytes(source, startIndex, startIndex + 1) > MAX_CHUNK_BYTES) {
    return undefined
  }
  let low = startIndex + 1
  let high = requestedEndIndex
  let safeEndIndex = low
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    if (sliceBytes(source, startIndex, middle) <= MAX_CHUNK_BYTES) {
      safeEndIndex = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return {
    content: source.lines.slice(startIndex, safeEndIndex).join("\n"),
    endLine: safeEndIndex,
  }
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
  source: IndexedSource
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
      startLine + SCOPE_WINDOW_LINES - 1
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

const iterateRepositoryChunks = function* ({
  index,
  repositoryKey,
  filePaths,
}: {
  index: RepositoryCodeIndex
  repositoryKey: string
  filePaths?: Iterable<string>
}): Generator<CodeChunk> {
  const selectedFiles = filePaths ? new Set(filePaths) : null
  for (const file of index.files) {
    if (selectedFiles && !selectedFiles.has(file.path)) continue
    const source = index.sourceByFile.get(file.path)
    if (!source) continue
    const indexedSource = indexSourceLines(source)
    const childrenByParent = new Map<string, ScopeDefinition[]>()
    for (const candidate of file.scopes) {
      if (!candidate.parentScopeId) continue
      const children = childrenByParent.get(candidate.parentScopeId)
      if (children) children.push(candidate)
      else childrenByParent.set(candidate.parentScopeId, [candidate])
    }
    const semanticScopes = file.scopes.flatMap((scope) => {
      if (scope.kind !== "class") return [scope]
      const firstChild = (childrenByParent.get(scope.id) ?? []).sort(
        (left, right) => left.startLine - right.startLine
      )[0]
      if (!firstChild) return [scope]
      const endLine = Math.min(
        scope.endLine,
        firstChild.startLine - 1,
        scope.startLine + 79
      )
      return endLine >= scope.startLine ? [{ ...scope, endLine }] : []
    })
    const scopedChunks = semanticScopes.flatMap((scope) =>
      scopeChunksFor({
        repositoryKey,
        file: file.path,
        language: file.language,
        source: indexedSource,
        scope,
      })
    )
    if (scopedChunks.length) {
      yield* scopedChunks
      continue
    }
    const chunk = fileChunkFor({
      repositoryKey,
      file: file.path,
      language: file.language,
      source: indexedSource,
    })
    if (chunk) yield chunk
  }
}

export const chunksForRepositoryIndex = (input: {
  index: RepositoryCodeIndex
  repositoryKey: string
  filePaths?: Iterable<string>
}) => [...iterateRepositoryChunks(input)]

export const countRepositoryChunks = (input: {
  index: RepositoryCodeIndex
  repositoryKey: string
  filePaths?: Iterable<string>
}) => {
  let count = 0
  for (const _chunk of iterateRepositoryChunks(input)) count += 1
  return count
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
  ]
    .filter(Boolean)
    .join("\n")

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

const isReviewCodeChunk = (payload: unknown): payload is ReviewCodeChunk => {
  if (!payload || typeof payload !== "object") return false
  const chunk = payload as Partial<ReviewCodeChunk>
  return Boolean(
    chunk.id &&
    chunk.repositoryKey &&
    chunk.file &&
    chunk.content &&
    chunk.repositoryId &&
    chunk.headSha &&
    chunk.reviewRunId
  )
}

export const indexReviewCodebase = async ({
  index,
  filePaths,
  chunks: selectedChunks,
  repositoryId,
  repositoryKey,
  headSha,
  reviewRunId,
  qdrant,
  onProgress,
}: IndexReviewCodebaseInput) => {
  const client = qdrantClient(qdrant)
  await ensureCollection(client, qdrant)
  await ensureReviewPayloadIndexes(client, qdrant.collection)
  await client.delete(qdrant.collection, {
    wait: true,
    filter: filterByRun({ repositoryId, headSha, reviewRunId }),
  })

  const chunks = (
    selectedChunks ??
    chunksForRepositoryIndex({
      index,
      repositoryKey,
      filePaths,
    })
  ).map(
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

  const upsertBatchSize = 64
  onProgress?.({
    status: "started",
    totalChunks: chunks.length,
    writtenChunks: 0,
  })
  for (let offset = 0; offset < chunks.length; offset += upsertBatchSize) {
    const batch = chunks.slice(offset, offset + upsertBatchSize)
    await client.upsert(qdrant.collection, {
      wait: true,
      points: batch.map((chunk) => ({
        id: chunk.id,
        vector: {
          text: chunkText(chunk),
          model: qdrant.model,
        },
        payload: chunk,
      })),
    } as Parameters<typeof client.upsert>[1])
    const writtenChunks = offset + batch.length
    if (
      writtenChunks === chunks.length ||
      writtenChunks % (upsertBatchSize * 10) === 0
    ) {
      onProgress?.({
        status: writtenChunks === chunks.length ? "completed" : "progress",
        totalChunks: chunks.length,
        writtenChunks,
      })
    }
  }
  if (chunks.length === 0) {
    onProgress?.({ status: "completed", totalChunks: 0, writtenChunks: 0 })
  }

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
