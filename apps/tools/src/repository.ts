import { execFile } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

type PreparedRepository = {
  path: string
  cleanup: () => Promise<void>
}

const resolveLocalPath = (repository: string) => {
  if (repository === "~") return homedir()
  if (repository.startsWith("~/")) {
    return path.join(homedir(), repository.slice(2))
  }
  return repository.startsWith("/") || repository.startsWith(".")
    ? repository
    : null
}

const runGit = (args: string[], cwd?: string) =>
  execFileAsync("git", args, {
    cwd,
    maxBuffer: 20 * 1024 * 1024,
    timeout: 10 * 60 * 1000,
  })

const normalizeGitHubRepository = (repository: string) => {
  if (
    repository.startsWith("git@") ||
    repository.startsWith("http://") ||
    repository.startsWith("https://")
  ) {
    return repository
  }
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    return `https://github.com/${repository}.git`
  }
  throw new Error("Unsupported repository path or URL")
}

export const prepareRepository = async ({
  repository,
  ref,
}: {
  repository: string
  ref?: string
}): Promise<PreparedRepository> => {
  const localRepository = resolveLocalPath(repository)
  if (localRepository && !ref) {
    return { path: localRepository, cleanup: async () => {} }
  }

  const directory = await mkdtemp(path.join(tmpdir(), "review-tools-repo-"))
  try {
    const cloneUrl = localRepository ?? normalizeGitHubRepository(repository)
    await runGit(["clone", "--quiet", cloneUrl, directory])
    if (ref) {
      if (ref.startsWith("-")) throw new Error("Invalid repository ref")
      await runGit(["checkout", "--quiet", ref], directory)
    }

    return {
      path: directory,
      cleanup: () => rm(directory, { recursive: true, force: true }),
    }
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
}
