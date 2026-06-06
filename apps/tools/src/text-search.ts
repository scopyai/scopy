import { readFile, realpath, stat } from "node:fs/promises"
import path from "node:path"
import type { RepositoryCodeIndex } from "./code-index"
import { discoverRepositoryFiles } from "./discover"
import { reviewIndexDecision } from "./review-file-policy"

export type SearchRepositoryTextInput = {
  repository: string
  query: string
  index?: RepositoryCodeIndex
  caseSensitive?: boolean
  maxResults?: number
  contextLines?: number
}

export type TextSearchMatch = {
  file: string
  line: number
  column: number
  text: string
  before: Array<{ line: number; text: string }>
  after: Array<{ line: number; text: string }>
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
const DEFAULT_CONTEXT_LINES = 1
const HARD_CONTEXT_LINES = 5

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

const renderMatch = (match: TextSearchMatch) => [
  `## ${match.file}:${match.line}:${match.column}`,
  "",
  "```text",
  ...match.before.map((line) => `${line.line}: ${line.text}`),
  `${match.line}: ${match.text}`,
  ...match.after.map((line) => `${line.line}: ${line.text}`),
  "```",
  "",
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
    "# Text Search Results",
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
  caseSensitive = false,
  maxResults = DEFAULT_MAX_RESULTS,
  contextLines = DEFAULT_CONTEXT_LINES,
}: SearchRepositoryTextInput): Promise<SearchRepositoryTextOutput> => {
  const repository = await realpath(inputRepository)
  const needle = caseSensitive ? query : query.toLocaleLowerCase()
  const resultLimit = Math.min(
    HARD_MAX_RESULTS,
    Math.max(1, Math.floor(maxResults)),
  )
  const contextLimit = Math.min(
    HARD_CONTEXT_LINES,
    Math.max(0, Math.floor(contextLines)),
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
      const haystack = caseSensitive ? text : text.toLocaleLowerCase()
      const columnIndex = haystack.indexOf(needle)
      if (columnIndex === -1) continue
      const beforeStart = Math.max(0, lineIndex - contextLimit)
      const afterEnd = Math.min(lines.length, lineIndex + contextLimit + 1)
      matches.push({
        file,
        line: lineIndex + 1,
        column: columnIndex + 1,
        text,
        before: lines.slice(beforeStart, lineIndex).map((line, index) => ({
          line: beforeStart + index + 1,
          text: line,
        })),
        after: lines.slice(lineIndex + 1, afterEnd).map((line, index) => ({
          line: lineIndex + index + 2,
          text: line,
        })),
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
