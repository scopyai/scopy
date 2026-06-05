import { readFile, realpath, stat } from "node:fs/promises"
import path from "node:path"

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

const DEFAULT_MAX_LINES = 200
const HARD_MAX_LINES = 500
const MAX_FILE_BYTES = 1024 * 1024
const MAX_OUTPUT_BYTES = 120 * 1024

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

const resolveInsideRepository = async (repository: string, file: string) => {
  if (path.isAbsolute(file)) {
    throw new Error("File path must be relative to the repository")
  }

  const normalized = path.normalize(file)
  if (normalized === "." || normalized.startsWith("..") || path.isAbsolute(normalized)) {
    throw new Error("File path must stay inside the repository")
  }

  const repositoryPath = await realpath(repository)
  const requestedPath = path.resolve(repositoryPath, normalized)
  const relative = path.relative(repositoryPath, requestedPath)
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("File path must stay inside the repository")
  }

  const absolutePath = await realpath(requestedPath)
  const realRelative = path.relative(repositoryPath, absolutePath)
  if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
    throw new Error("File path must stay inside the repository")
  }

  return { repositoryPath, absolutePath, normalized: relative }
}

export const readRepositoryFile = async ({
  repository,
  file,
  startLine = 1,
  maxLines = DEFAULT_MAX_LINES,
}: ReadRepositoryFileInput): Promise<ReadRepositoryFileOutput> => {
  const { repositoryPath, absolutePath, normalized } =
    await resolveInsideRepository(repository, file)
  const fileStats = await stat(absolutePath)
  if (!fileStats.isFile()) {
    throw new Error(`Repository path is not a file: ${normalized}`)
  }
  if (fileStats.size > MAX_FILE_BYTES) {
    throw new Error(
      `Repository file is too large to read safely: ${normalized} (${fileStats.size} bytes)`,
    )
  }

  const buffer = await readFile(absolutePath)
  if (isBinary(buffer)) {
    throw new Error(`Repository file appears to be binary: ${normalized}`)
  }

  const lines = buffer.toString("utf8").split(/\r?\n/)
  const safeStartLine = Math.max(1, Math.floor(startLine))
  const safeMaxLines = Math.min(
    HARD_MAX_LINES,
    Math.max(1, Math.floor(maxLines)),
  )
  const selected = lines.slice(safeStartLine - 1, safeStartLine - 1 + safeMaxLines)
  let content = selected
    .map((line, index) => `${safeStartLine + index}: ${line}`)
    .join("\n")
  let truncated =
    safeStartLine - 1 + safeMaxLines < lines.length || maxLines > HARD_MAX_LINES

  while (Buffer.byteLength(content, "utf8") > MAX_OUTPUT_BYTES && selected.length > 1) {
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
    endLine: selected.length === 0 ? safeStartLine : safeStartLine + selected.length - 1,
    totalLines: lines.length,
    truncated,
    content,
    bytes: Buffer.byteLength(content, "utf8"),
  }
}
