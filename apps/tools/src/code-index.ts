import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import { gunzip, gzip } from "node:zlib"
import Parser from "tree-sitter"
import { adaptersByExtension } from "./adapters"
import { discoverRepositoryFiles, discoverRepositoryGitBlobs } from "./discover"
import { reviewIndexDecision } from "./review-file-policy"
import {
  MAX_REPOSITORY_FILE_BYTES,
  readRepositoryTextFile,
  resolveRepositoryRoot,
} from "./repository-file"
import { resolveGraphs } from "./resolve"
import type {
  CallEdge,
  Diagnostic,
  ExtractedFile,
  FileDependencyEdge,
  ScopeDefinition,
  SymbolDefinition,
} from "./types"

const sourceLikeExtensions = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".cs",
  ".go",
  ".java",
  ".kt",
  ".php",
  ".py",
  ".rb",
  ".rs",
  ".swift",
  ".vue",
])
const MAX_REPOSITORY_INDEX_BYTES = 512 * 1024 * 1024
export const REPOSITORY_CODE_INDEX_VERSION = "6"

export type RepositoryCodeIndexProgress = {
  phase: "snapshot" | "discovery" | "parsing" | "graph" | "cache"
  status: "started" | "progress" | "completed"
  details?: Record<string, unknown>
}

export type RepositoryCodeIndexCacheStats = {
  snapshotHit: boolean
  parsedFiles: number
  blobCacheReusedFiles: number
  discoveryMs: number
  parsingMs: number
  graphMs: number
  totalMs: number
}

export type RepositoryCodeIndex = {
  repository: string
  repositoryFiles: string[]
  discoveredFiles: number
  ignoredFiles: Array<{ file: string; reason: "hard-ignore" | "soft-ignore" }>
  detectedLanguages: Record<string, number>
  files: ExtractedFile[]
  sourceByFile: Map<string, string>
  blobByFile: Map<string, string>
  scopesById: Map<string, ScopeDefinition>
  symbolsById: Map<string, SymbolDefinition>
  graph: {
    dependencies: FileDependencyEdge[]
    symbols: SymbolDefinition[]
    edges: CallEdge[]
    unresolvedCalls: Awaited<
      ReturnType<typeof resolveGraphs>
    >["unresolvedCalls"]
    diagnostics: Diagnostic[]
  }
  diagnostics: Diagnostic[]
  cache: RepositoryCodeIndexCacheStats
}

type CachedFileExtraction = {
  version: string
  file: string
  blob: string
  source: string
  extracted: ExtractedFile
}

type CachedSnapshotManifest = {
  version: string
  snapshotKey: string
  policyKey: string
  repositoryFiles: string[]
  discoveredFiles: number
  blobs: Array<[string, string]>
}

export type RepositoryCodeIndexCacheOptions = {
  directory: string
  namespace: string
  snapshotKey: string
}

const hash = (value: string) => createHash("sha256").update(value).digest("hex")
const gzipAsync = promisify(gzip)
const gunzipAsync = promisify(gunzip)

const policyKeyFor = (changedFiles: string[]) =>
  hash([...changedFiles].sort().join("\0"))

const snapshotPathFor = (
  cache: RepositoryCodeIndexCacheOptions,
  snapshotKey = cache.snapshotKey,
  changedFiles: string[] = []
) =>
  path.join(
    cache.directory,
    REPOSITORY_CODE_INDEX_VERSION,
    "snapshots",
    `${hash(`${snapshotKey}\0${policyKeyFor(changedFiles)}`)}.json`
  )

const fileCachePathFor = (
  cache: RepositoryCodeIndexCacheOptions,
  file: string,
  blob: string
) =>
  path.join(
    cache.directory,
    REPOSITORY_CODE_INDEX_VERSION,
    "files",
    hash(`${cache.namespace}\0${file}\0${blob}`),
    "entry.json"
  )

const readCachedJson = async <TValue>(file: string): Promise<TValue | null> => {
  try {
    const stored = await readFile(file)
    const contents =
      stored[0] === 0x1f && stored[1] === 0x8b
        ? await gunzipAsync(stored)
        : stored
    return JSON.parse(contents.toString("utf8")) as TValue
  } catch {
    return null
  }
}

const writeCachedJson = async (file: string, value: unknown) => {
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, await gzipAsync(JSON.stringify(value)))
    await rename(temporary, file)
  } finally {
    await rm(temporary, { force: true })
  }
}

const validSnapshotManifest = (
  value: CachedSnapshotManifest | null,
  snapshotKey: string,
  changedFiles: string[]
): value is CachedSnapshotManifest =>
  Boolean(
    value &&
    value.version === REPOSITORY_CODE_INDEX_VERSION &&
    value.snapshotKey === snapshotKey &&
    value.policyKey === policyKeyFor(changedFiles) &&
    Array.isArray(value.repositoryFiles) &&
    Array.isArray(value.blobs)
  )

const validFileExtraction = (
  value: CachedFileExtraction | null,
  file: string,
  blob: string
): value is CachedFileExtraction =>
  Boolean(
    value &&
    value.version === REPOSITORY_CODE_INDEX_VERSION &&
    value.file === file &&
    value.blob === blob &&
    value.extracted?.path === file &&
    typeof value.source === "string"
  )

const compareDiagnostics = (a: Diagnostic, b: Diagnostic) => {
  if (!a.file && !b.file) return a.message.localeCompare(b.message)
  if (!a.file) return -1
  if (!b.file) return 1
  return (
    a.file.localeCompare(b.file) ||
    (a.line ?? 0) - (b.line ?? 0) ||
    (a.column ?? 0) - (b.column ?? 0) ||
    a.message.localeCompare(b.message)
  )
}

export const buildRepositoryCodeIndex = async ({
  repository: inputRepository,
  changedFiles = [],
  cache,
  onProgress,
}: {
  repository: string
  changedFiles?: string[]
  cache?: RepositoryCodeIndexCacheOptions
  onProgress?: (progress: RepositoryCodeIndexProgress) => void
}): Promise<RepositoryCodeIndex> => {
  const startedAt = Date.now()
  const repository = await resolveRepositoryRoot(inputRepository)
  const cacheStats: RepositoryCodeIndexCacheStats = {
    snapshotHit: false,
    parsedFiles: 0,
    blobCacheReusedFiles: 0,
    discoveryMs: 0,
    parsingMs: 0,
    graphMs: 0,
    totalMs: 0,
  }
  let manifest: CachedSnapshotManifest | null = null
  if (cache) {
    onProgress?.({ phase: "snapshot", status: "started" })
    const candidate = await readCachedJson<CachedSnapshotManifest>(
      snapshotPathFor(cache, cache.snapshotKey, changedFiles)
    )
    if (validSnapshotManifest(candidate, cache.snapshotKey, changedFiles)) {
      manifest = candidate
      cacheStats.snapshotHit = true
    }
    onProgress?.({
      phase: "snapshot",
      status: "completed",
      details: {
        hit: Boolean(manifest),
        files: manifest?.repositoryFiles.length,
      },
    })
  }

  const discoveryStartedAt = Date.now()
  onProgress?.({ phase: "discovery", status: "started" })
  const [discoveredRepositoryFiles, discoveredBlobs] = manifest
    ? [manifest.repositoryFiles, new Map(manifest.blobs)]
    : await Promise.all([
        discoverRepositoryFiles(repository),
        discoverRepositoryGitBlobs(repository),
      ])
  cacheStats.discoveryMs = Date.now() - discoveryStartedAt
  onProgress?.({
    phase: "discovery",
    status: "completed",
    details: { files: discoveredRepositoryFiles.length },
  })

  const changedFileSet = new Set(changedFiles)
  const ignoredFiles: RepositoryCodeIndex["ignoredFiles"] = []
  const repositoryFiles = discoveredRepositoryFiles.filter((file) => {
    const decision = reviewIndexDecision(file, changedFileSet)
    if (!decision.index && decision.reason) {
      ignoredFiles.push({ file, reason: decision.reason })
    }
    return decision.index
  })
  const diagnostics: Diagnostic[] = []
  const detectedLanguages: Record<string, number> = {}
  const sourceByFile = new Map<string, string>()
  const blobByFile = new Map<string, string>()
  const extractedFiles: ExtractedFile[] = []
  const pendingFileCacheWrites: Array<Promise<void>> = []
  const parsers = new Map<string, Parser>()
  let indexedBytes = 0
  let fileCacheEntriesWritten = 0

  const parsingStartedAt = Date.now()
  onProgress?.({
    phase: "parsing",
    status: "started",
    details: {
      files: repositoryFiles.length,
      snapshotHit: cacheStats.snapshotHit,
    },
  })

  for (let fileIndex = 0; fileIndex < repositoryFiles.length; fileIndex += 1) {
    const file = repositoryFiles[fileIndex]!
    const extension = path.extname(file).toLowerCase()
    const adapter = adaptersByExtension.get(extension)
    if (!adapter) {
      if (sourceLikeExtensions.has(extension)) {
        diagnostics.push({
          kind: "unsupported-language",
          file,
          message: `No language adapter is registered for '${extension}' files`,
        })
      }
      continue
    }

    let blob = discoveredBlobs.get(file)
    let source: string | undefined
    let extracted: ExtractedFile | undefined
    if (cache && blob) {
      const cached = await readCachedJson<CachedFileExtraction>(
        fileCachePathFor(cache, file, blob)
      )
      if (validFileExtraction(cached, file, blob)) {
        source = cached.source
        extracted = cached.extracted
        cacheStats.blobCacheReusedFiles += 1
      }
    }

    if (source === undefined) {
      const result = await readRepositoryTextFile({
        repository,
        file,
        maxBytes: MAX_REPOSITORY_FILE_BYTES,
      }).catch((error: unknown) => {
        diagnostics.push({
          kind: "parse-error",
          file,
          message: error instanceof Error ? error.message : String(error),
        })
        return null
      })
      if (!result) continue
      source = result.source
      blob ??= `content:${hash(source)}`
    }
    blob ??= `content:${hash(source)}`

    const bytes = Buffer.byteLength(source, "utf8")
    if (indexedBytes + bytes > MAX_REPOSITORY_INDEX_BYTES) {
      throw new Error("Repository source is too large to index")
    }
    indexedBytes += bytes

    if (!extracted) {
      let parser = parsers.get(adapter.id)
      if (!parser) {
        parser = new Parser()
        parser.setLanguage(adapter.language)
        parsers.set(adapter.id, parser)
      }
      const tree = parser.parse(source)
      try {
        extracted = adapter.extract(file, source, tree)
      } finally {
        const deletableTree = tree as Parser.Tree & { delete?: () => void }
        deletableTree.delete?.()
      }
      cacheStats.parsedFiles += 1
      if (cache) {
        pendingFileCacheWrites.push(
          writeCachedJson(fileCachePathFor(cache, file, blob), {
            version: REPOSITORY_CODE_INDEX_VERSION,
            file,
            blob,
            source,
            extracted,
          } satisfies CachedFileExtraction)
        )
        fileCacheEntriesWritten += 1
        if (pendingFileCacheWrites.length >= 16) {
          await Promise.all(pendingFileCacheWrites)
          pendingFileCacheWrites.length = 0
        }
      }
    }

    detectedLanguages[extracted.language] =
      (detectedLanguages[extracted.language] ?? 0) + 1
    sourceByFile.set(file, source)
    blobByFile.set(file, blob)
    extractedFiles.push(extracted)
    diagnostics.push(...extracted.diagnostics)

    if ((fileIndex + 1) % 500 === 0) {
      onProgress?.({
        phase: "parsing",
        status: "progress",
        details: {
          processedFiles: fileIndex + 1,
          totalFiles: repositoryFiles.length,
          parsedFiles: cacheStats.parsedFiles,
          reusedFiles: cacheStats.blobCacheReusedFiles,
        },
      })
    }
  }

  cacheStats.parsingMs = Date.now() - parsingStartedAt
  onProgress?.({
    phase: "parsing",
    status: "completed",
    details: {
      parsedFiles: cacheStats.parsedFiles,
      reusedFiles: cacheStats.blobCacheReusedFiles,
      indexedBytes,
    },
  })

  const graphStartedAt = Date.now()
  onProgress?.({ phase: "graph", status: "started" })
  const graph = await resolveGraphs({
    repository,
    files: extractedFiles,
    repositoryFiles,
  })
  cacheStats.graphMs = Date.now() - graphStartedAt
  onProgress?.({
    phase: "graph",
    status: "completed",
    details: {
      dependencies: graph.dependencies.length,
      symbols: graph.symbols.length,
      resolvedCalls: graph.edges.length,
    },
  })
  diagnostics.push(...graph.diagnostics)

  const index: RepositoryCodeIndex = {
    repository,
    repositoryFiles,
    discoveredFiles: discoveredRepositoryFiles.length,
    ignoredFiles,
    detectedLanguages: Object.fromEntries(
      Object.entries(detectedLanguages).sort(([a], [b]) => a.localeCompare(b))
    ),
    files: extractedFiles,
    sourceByFile,
    blobByFile,
    scopesById: new Map(
      extractedFiles.flatMap((file) =>
        file.scopes.map((scope) => [scope.id, scope])
      )
    ),
    symbolsById: new Map(graph.symbols.map((symbol) => [symbol.id, symbol])),
    graph: {
      dependencies: graph.dependencies,
      symbols: graph.symbols,
      edges: graph.edges,
      unresolvedCalls: graph.unresolvedCalls,
      diagnostics: graph.diagnostics,
    },
    diagnostics: diagnostics.sort(compareDiagnostics),
    cache: cacheStats,
  }

  if (cache) {
    onProgress?.({ phase: "cache", status: "started" })
    await Promise.all(pendingFileCacheWrites)
    await writeCachedJson(
      snapshotPathFor(cache, cache.snapshotKey, changedFiles),
      {
        version: REPOSITORY_CODE_INDEX_VERSION,
        snapshotKey: cache.snapshotKey,
        policyKey: policyKeyFor(changedFiles),
        repositoryFiles: discoveredRepositoryFiles,
        discoveredFiles: discoveredRepositoryFiles.length,
        blobs: [...discoveredBlobs.entries()],
      } satisfies CachedSnapshotManifest
    )
    onProgress?.({
      phase: "cache",
      status: "completed",
      details: { fileEntriesWritten: fileCacheEntriesWritten },
    })
  }
  cacheStats.totalMs = Date.now() - startedAt
  return index
}

export const lineSlice = (source: string, startLine: number, endLine: number) =>
  source
    .split(/\r?\n/)
    .slice(startLine - 1, endLine)
    .join("\n")

export const lineAt = (source: string, line: number) =>
  source.split(/\r?\n/)[line - 1] ?? ""

export const scopeForSymbol = (
  index: RepositoryCodeIndex,
  symbol: SymbolDefinition
) => {
  const scopes =
    index.files.find((file) => file.path === symbol.file)?.scopes ?? []
  return scopes
    .filter(
      (scope) =>
        scope.name === symbol.name &&
        scope.kind === symbol.kind &&
        scope.startLine <= symbol.line &&
        scope.endLine >= symbol.line
    )
    .sort((a, b) => a.endLine - a.startLine - (b.endLine - b.startLine))[0]
}
