import { readFile, realpath, stat } from "node:fs/promises"
import path from "node:path"
import type { RepositoryCodeIndex } from "./code-index"
import { discoverRepositoryFiles } from "./discover"
import { reviewIndexDecision } from "./review-file-policy"
import type { ScopeDefinition } from "./types"

export type SearchRepositoryTextInput = {
  repository: string
  query: string
  index?: RepositoryCodeIndex
  maxResults?: number
}

export type TextSearchSymbol = {
  name: string
  kind: ScopeDefinition["kind"]
  startLine: number
  endLine: number
  signature?: string
  returnType?: string
}

export type TextSearchMatch = {
  file: string
  line: number
  column: number
  symbol?: TextSearchSymbol
}

export type SearchRepositoryTextOutput = {
  repositoryPath: string
  query: string
  matches: TextSearchMatch[]
  markdown: string
  stats: {
    filesSearched: number
    filesSkipped: number
    matches: number
    truncated: boolean
    bytes: number
  }
}

const MAX_FILE_BYTES = 1024 * 1024
const DEFAULT_MAX_RESULTS = 50
const HARD_MAX_RESULTS = 100

const isBinary = (buffer: Buffer) => {
  if (buffer.includes(0)) return true
  const sample = buffer.subarray(0, Math.min(buffer.length, 8_000))
  let suspicious = 0
  for (const byte of sample) {
    if (byte === 9 || byte === 10 || byte === 13) continue
    if (byte >= 32 && byte <= 126) continue
    if (byte >= 128) continue
    suspicious += 1
  }
  return sample.length > 0 && suspicious / sample.length > 0.3
}

const safeReadTextFile = async (repository: string, file: string) => {
  const absolutePath = path.join(repository, file)
  const fileStats = await stat(absolutePath)
  if (!fileStats.isFile() || fileStats.size > MAX_FILE_BYTES) return undefined
  const buffer = await readFile(absolutePath)
  if (isBinary(buffer)) return undefined
  return buffer.toString("utf8")
}

const filesForSearch = async ({
  repository,
  index,
}: {
  repository: string
  index?: RepositoryCodeIndex
}) => {
  if (index) return index.repositoryFiles
  const discovered = await discoverRepositoryFiles(repository)
  return discovered.filter((file) => reviewIndexDecision(file).index)
}

const symbolForLine = (
  index: RepositoryCodeIndex | undefined,
  file: string,
  line: number,
): TextSearchSymbol | undefined => {
  const scope = index?.files
    .find((candidate) => candidate.path === file)
    ?.scopes.filter((candidate) => {
      if (candidate.kind === "top-level") return false
      return candidate.startLine <= line && candidate.endLine >= line
    })
    .sort((a, b) => (a.endLine - a.startLine) - (b.endLine - b.startLine))[0]

  return scope
    ? {
        name: scope.name,
        kind: scope.kind,
        startLine: scope.startLine,
        endLine: scope.endLine,
        signature: scope.signature,
        returnType: scope.returnType,
      }
    : undefined
}

const renderMatch = (match: TextSearchMatch) => [
  `- ${match.file}:${match.line}:${match.column}${
    match.symbol
      ? ` in ${match.symbol.kind} ${
          match.symbol.signature ?? match.symbol.name
        } ${match.symbol.startLine}-${match.symbol.endLine}`
      : ""
  }`,
]

const renderMarkdown = ({
  query,
  matches,
  truncated,
}: {
  query: string
  matches: TextSearchMatch[]
  truncated: boolean
}) =>
  [
    "# Text Locations",
    "",
    `Query: ${query}`,
    `Matches: ${matches.length}${truncated ? " (truncated)" : ""}`,
    "",
    ...matches.flatMap(renderMatch),
  ].join("\n")

export const searchRepositoryText = async ({
  repository: inputRepository,
  query,
  index,
  maxResults = DEFAULT_MAX_RESULTS,
}: SearchRepositoryTextInput): Promise<SearchRepositoryTextOutput> => {
  const repository = await realpath(inputRepository)
  const needle = query.toLocaleLowerCase()
  const resultLimit = Math.min(
    HARD_MAX_RESULTS,
    Math.max(1, Math.floor(maxResults)),
  )
  const matches: TextSearchMatch[] = []
  let filesSearched = 0
  let filesSkipped = 0
  let truncated = false

  if (!needle.trim()) {
    return {
      repositoryPath: repository,
      query,
      matches: [],
      markdown: renderMarkdown({ query, matches: [], truncated: false }),
      stats: {
        filesSearched,
        filesSkipped,
        matches: 0,
        truncated: false,
        bytes: 0,
      },
    }
  }

  for (const file of await filesForSearch({ repository, index })) {
    let source = index?.sourceByFile.get(file)
    if (!source) {
      source = await safeReadTextFile(repository, file)
    }
    if (!source) {
      filesSkipped += 1
      continue
    }
    filesSearched += 1
    const lines = source.split(/\r?\n/)
    for (const [lineIndex, text] of lines.entries()) {
      const haystack = text.toLocaleLowerCase()
      const columnIndex = haystack.indexOf(needle)
      if (columnIndex === -1) continue
      matches.push({
        file,
        line: lineIndex + 1,
        column: columnIndex + 1,
        symbol: symbolForLine(index, file, lineIndex + 1),
      })
      if (matches.length >= resultLimit) {
        truncated = true
        break
      }
    }
    if (truncated) break
  }

  const markdown = renderMarkdown({ query, matches, truncated })
  return {
    repositoryPath: repository,
    query,
    matches,
    markdown,
    stats: {
      filesSearched,
      filesSkipped,
      matches: matches.length,
      truncated,
      bytes: Buffer.byteLength(markdown, "utf8"),
    },
  }
}
