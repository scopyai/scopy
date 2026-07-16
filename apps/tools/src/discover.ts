import { execFile } from "node:child_process"
import { readdir } from "node:fs/promises"
import { promisify } from "node:util"
import path from "node:path"
import { resolveRepositoryFile, resolveRepositoryRoot } from "./repository-file"

const execFileAsync = promisify(execFile)
const excludedDirectories = new Set([
  ".git",
  ".cache",
  ".next",
  ".nitro",
  ".output",
  ".tanstack",
  ".tmp",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
])

const MAX_REPOSITORY_FILES = 100_000

const recursivelyListFiles = async (
  root: string,
  maxFiles: number,
  directory = root,
  files: string[] = []
) => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue
    const absolutePath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      await recursivelyListFiles(root, maxFiles, absolutePath, files)
    } else if (entry.isFile()) {
      files.push(path.relative(root, absolutePath))
      if (files.length > maxFiles)
        throw new Error("Repository contains too many files")
    }
  }
  return files
}

const existingFiles = async (repository: string, files: string[]) => {
  const existing: string[] = []
  const concurrency = 128
  for (let offset = 0; offset < files.length; offset += concurrency) {
    const batch = files.slice(offset, offset + concurrency)
    const results = await Promise.all(
      batch.map(async (file) => {
        try {
          await resolveRepositoryFile(repository, file)
          return file
        } catch {
          return undefined
        }
      })
    )
    existing.push(...results.filter((file): file is string => Boolean(file)))
  }
  return existing
}

export const discoverRepositoryFiles = async (
  inputRepository: string,
  maxFiles = MAX_REPOSITORY_FILES
) => {
  const repository = await resolveRepositoryRoot(inputRepository)

  let stdout: Buffer
  try {
    const result = await execFileAsync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      {
        cwd: repository,
        encoding: "buffer",
        maxBuffer: 64 * 1024 * 1024,
        timeout: 2 * 60 * 1000,
      }
    )
    stdout = result.stdout
  } catch {
    return (await recursivelyListFiles(repository, maxFiles)).sort()
  }

  const files = stdout.toString("utf8").split("\0").filter(Boolean).sort()
  if (files.length > maxFiles)
    throw new Error("Repository contains too many files")
  return existingFiles(repository, files)
}
