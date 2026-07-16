import { readFile, realpath, stat } from "node:fs/promises"
import path from "node:path"

export const MAX_REPOSITORY_FILE_BYTES = 5 * 1024 * 1024

const isInside = (root: string, candidate: string) => {
  const relative = path.relative(root, candidate)
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

export const resolveRepositoryRoot = async (repository: string) => {
  const root = await realpath(repository)
  if (!(await stat(root)).isDirectory()) throw new Error(`Not a repository directory: ${repository}`)
  return root
}

export const normalizeRepositoryFile = (repository: string, file: string) => {
  if (path.isAbsolute(file)) throw new Error("File path must be relative")
  const absolutePath = path.resolve(repository, file)
  if (!isInside(repository, absolutePath)) throw new Error("File must be inside the repository")
  return { file: path.relative(repository, absolutePath), absolutePath }
}

export const resolveRepositoryFile = async (repository: string, file: string) => {
  const normalized = normalizeRepositoryFile(repository, file)
  const resolvedPath = await realpath(normalized.absolutePath)
  if (!isInside(repository, resolvedPath)) throw new Error("File must be inside the repository")
  const fileStats = await stat(resolvedPath)
  if (!fileStats.isFile()) throw new Error(`Not a repository file: ${normalized.file}`)
  return {
    file: normalized.file,
    absolutePath: resolvedPath,
    bytes: fileStats.size,
  }
}

export const readRepositoryFileBuffer = async ({
  repository,
  file,
  maxBytes,
}: {
  repository: string
  file: string
  maxBytes: number
}) => {
  const resolved = await resolveRepositoryFile(repository, file)
  const tooLarge = (bytes: number) =>
    new Error(`Repository file is too large: ${resolved.file} (${bytes} bytes, maximum ${maxBytes})`)
  if (resolved.bytes > maxBytes) throw tooLarge(resolved.bytes)
  const buffer = await readFile(resolved.absolutePath)
  if (buffer.length > maxBytes) throw tooLarge(buffer.length)
  return { file: resolved.file, bytes: buffer.length, buffer }
}

export const readRepositoryTextFile = async (input: { repository: string; file: string; maxBytes: number }) => {
  const result = await readRepositoryFileBuffer(input)
  return { ...result, source: result.buffer.toString("utf8") }
}
