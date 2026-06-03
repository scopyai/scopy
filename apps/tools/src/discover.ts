import { execFile } from "node:child_process"
import { readdir, stat } from "node:fs/promises"
import { promisify } from "node:util"
import path from "node:path"

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

const recursivelyListFiles = async (root: string, directory = root) => {
  const files: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue
    const absolutePath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await recursivelyListFiles(root, absolutePath)))
    } else if (entry.isFile()) {
      files.push(path.relative(root, absolutePath))
    }
  }
  return files
}

export const discoverRepositoryFiles = async (repository: string) => {
  const repositoryStats = await stat(repository)
  if (!repositoryStats.isDirectory()) {
    throw new Error(`Repository path is not a directory: ${repository}`)
  }

  try {
    const { stdout } = await execFileAsync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      { cwd: repository, encoding: "buffer", maxBuffer: 20 * 1024 * 1024 },
    )
    return stdout
      .toString("utf8")
      .split("\0")
      .filter(Boolean)
      .sort()
  } catch {
    return (await recursivelyListFiles(repository)).sort()
  }
}
