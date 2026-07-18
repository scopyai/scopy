import {
  isBinaryBuffer,
  readRepositoryFileBuffer,
  resolveRepositoryRoot,
} from "./repository-file"

export type ReadRepositoryFileInput = {
  repository: string
  file: string
  startLine?: number
  maxLines?: number
}

export type ReadRepositoryFileOutput = {
  repositoryPath: string
  file: string
  startLine: number
  endLine: number
  totalLines: number
  truncated: boolean
  content: string
  bytes: number
}

const DEFAULT_MAX_LINES = 300
const HARD_MAX_LINES = 800
const MAX_FILE_BYTES = 1024 * 1024
const MAX_OUTPUT_BYTES = 40 * 1024

export const readRepositoryFile = async ({
  repository,
  file,
  startLine = 1,
  maxLines = DEFAULT_MAX_LINES,
}: ReadRepositoryFileInput): Promise<ReadRepositoryFileOutput> => {
  const repositoryPath = await resolveRepositoryRoot(repository)
  const result = await readRepositoryFileBuffer({
    repository: repositoryPath,
    file,
    maxBytes: MAX_FILE_BYTES,
  })
  const { buffer } = result
  const normalized = result.file
  if (isBinaryBuffer(buffer)) {
    throw new Error(`Repository file appears to be binary: ${normalized}`)
  }

  const lines = buffer.toString("utf8").split(/\r?\n/)
  const safeStartLine = Math.max(1, Math.floor(startLine))
  const safeMaxLines = Math.min(
    HARD_MAX_LINES,
    Math.max(1, Math.floor(maxLines))
  )
  const selected = lines.slice(
    safeStartLine - 1,
    safeStartLine - 1 + safeMaxLines
  )
  let content = selected
    .map((line, index) => `${safeStartLine + index}: ${line}`)
    .join("\n")
  let truncated =
    safeStartLine - 1 + safeMaxLines < lines.length || maxLines > HARD_MAX_LINES

  while (
    Buffer.byteLength(content, "utf8") > MAX_OUTPUT_BYTES &&
    selected.length > 1
  ) {
    selected.pop()
    truncated = true
    content = selected
      .map((line, index) => `${safeStartLine + index}: ${line}`)
      .join("\n")
  }

  return {
    repositoryPath,
    file: normalized,
    startLine: safeStartLine,
    endLine:
      selected.length === 0
        ? safeStartLine
        : safeStartLine + selected.length - 1,
    totalLines: lines.length,
    truncated,
    content,
    bytes: Buffer.byteLength(content, "utf8"),
  }
}
