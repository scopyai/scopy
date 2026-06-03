import { execFile } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

export type PreparedRepository = {
  path: string
  cleanup: () => Promise<void>
}

const isLocalPath = (repository: string) =>
  repository.startsWith("/") ||
  repository.startsWith(".") ||
  repository.startsWith("~")

const normalizeGitHubRepository = (repository: string) => {
  if (repository.startsWith("git@") || repository.startsWith("http://") || repository.startsWith("https://")) {
    return repository
  }
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    return `https://github.com/${repository}.git`
  }
  return repository
}

export const prepareRepository = async ({
  repository,
  ref,
}: {
  repository: string
  ref?: string
}): Promise<PreparedRepository> => {
  if (isLocalPath(repository)) {
    return { path: repository, cleanup: async () => {} }
  }

  const directory = await mkdtemp(path.join(tmpdir(), "review-tools-repo-"))
  const cloneUrl = normalizeGitHubRepository(repository)
  await execFileAsync("git", ["clone", "--quiet", cloneUrl, directory], {
    maxBuffer: 20 * 1024 * 1024,
  })
  if (ref) {
    await execFileAsync("git", ["checkout", "--quiet", ref], {
      cwd: directory,
      maxBuffer: 20 * 1024 * 1024,
    })
  }

  return {
    path: directory,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  }
}
