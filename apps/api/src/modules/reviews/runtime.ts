import { execFile } from "node:child_process"
import { chmod, mkdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import { buildRepositoryCodeIndex, type QdrantInferenceConfig } from "tools"
import type { pullRequest, repository } from "../../db/schema"
import { env } from "../../env"
import { createGitHubInstallationAccessToken } from "../github/service"

const execFileAsync = promisify(execFile)

type Repository = typeof repository.$inferSelect
type PullRequest = typeof pullRequest.$inferSelect

export type ReviewRuntimePaths = {
  runPath: string
  repositoryPath: string
  baseRepositoryPath: string
  indexPath: string
  baseIndexPath: string
  metadataPath: string
}

export type PreparedReviewRuntime = {
  paths: ReviewRuntimePaths
  codeIndex: Awaited<ReturnType<typeof buildRepositoryCodeIndex>>
  baseSha: string
  loadBase: () => Promise<{
    repositoryPath: string
    index: Awaited<ReturnType<typeof buildRepositoryCodeIndex>>
  }>
  qdrant: QdrantInferenceConfig | null
}

const safeSegment = (value: string) => value.replace(/[^A-Za-z0-9_.-]/g, "_")

export const getReviewRuntimePaths = ({
  repositoryId,
  headSha,
  reviewRunId,
}: {
  repositoryId: string
  headSha: string
  reviewRunId: string
}): ReviewRuntimePaths => {
  const runPath = path.resolve(
    env.REVIEW_WORKDIR,
    safeSegment(repositoryId),
    safeSegment(headSha),
    safeSegment(reviewRunId)
  )

  return {
    runPath,
    repositoryPath: path.join(runPath, "repo"),
    baseRepositoryPath: path.join(runPath, "repo-base"),
    indexPath: path.join(runPath, "index", "ast.json"),
    baseIndexPath: path.join(runPath, "index", "base-ast.json"),
    metadataPath: path.join(runPath, "metadata.json"),
  }
}

const createAskPassScript = async (runPath: string) => {
  const scriptPath = path.join(runPath, "git-askpass.sh")
  await writeFile(
    scriptPath,
    [
      "#!/bin/sh",
      'case "$1" in',
      "  *Username*) printf '%s\\n' 'x-access-token' ;;",
      "  *) printf '%s\\n' \"$REVIEW_GITHUB_TOKEN\" ;;",
      "esac",
      "",
    ].join("\n"),
    "utf8"
  )
  await chmod(scriptPath, 0o700)
  return scriptPath
}

const gitEnv = ({ askPass, token }: { askPass: string; token: string }) => ({
  ...process.env,
  GIT_ASKPASS: askPass,
  GIT_TERMINAL_PROMPT: "0",
  REVIEW_GITHUB_TOKEN: token,
})

const cloneRepository = async ({
  repo,
  pullRequest,
  installationId,
  paths,
}: {
  repo: Repository
  pullRequest: PullRequest
  installationId: string
  paths: ReviewRuntimePaths
}) => {
  await rm(paths.repositoryPath, { recursive: true, force: true })
  await rm(paths.baseRepositoryPath, { recursive: true, force: true })
  const token = await createGitHubInstallationAccessToken(installationId)
  const askPass = await createAskPassScript(paths.runPath)
  const env = gitEnv({ askPass, token })
  await execFileAsync(
    "git",
    [
      "clone",
      "--quiet",
      "--no-tags",
      "--filter=blob:none",
      `https://github.com/${repo.fullName}.git`,
      paths.repositoryPath,
    ],
    {
      env,
      maxBuffer: 20 * 1024 * 1024,
    }
  )
  await execFileAsync(
    "git",
    ["fetch", "--quiet", "origin", pullRequest.baseRef],
    {
      cwd: paths.repositoryPath,
      env,
      maxBuffer: 20 * 1024 * 1024,
    }
  )
  await execFileAsync(
    "git",
    ["fetch", "--quiet", "origin", `pull/${pullRequest.number}/head`],
    {
      cwd: paths.repositoryPath,
      env,
      maxBuffer: 20 * 1024 * 1024,
    }
  )
  await execFileAsync("git", ["checkout", "--quiet", pullRequest.headSha], {
    cwd: paths.repositoryPath,
    env,
    maxBuffer: 20 * 1024 * 1024,
  })
  return env
}

const revParse = async (repositoryPath: string, ref: string) => {
  const { stdout } = await execFileAsync("git", ["rev-parse", ref], {
    cwd: repositoryPath,
    maxBuffer: 1024 * 1024,
  })
  return stdout.trim()
}

const serializeCodeIndex = (
  index: Awaited<ReturnType<typeof buildRepositoryCodeIndex>>
) => ({
  repository: index.repository,
  repositoryFiles: index.repositoryFiles,
  discoveredFiles: index.discoveredFiles,
  ignoredFiles: index.ignoredFiles,
  detectedLanguages: index.detectedLanguages,
  files: index.files,
  graph: index.graph,
  diagnostics: index.diagnostics,
})

const qdrantConfig = (): QdrantInferenceConfig | null => {
  if (!env.QDRANT_URL) return null
  return {
    url: env.QDRANT_URL,
    apiKey: env.QDRANT_API_KEY,
    collection: env.QDRANT_COLLECTION,
    model: env.QDRANT_INFERENCE_MODEL,
    vectorSize: env.QDRANT_VECTOR_SIZE,
  }
}

export const prepareReviewRuntime = async ({
  reviewRunId,
  repo,
  pullRequest,
  installationId,
  changedFiles,
}: {
  reviewRunId: string
  repo: Repository
  pullRequest: PullRequest
  installationId: string
  changedFiles?: string[]
}): Promise<PreparedReviewRuntime> => {
  const paths = getReviewRuntimePaths({
    repositoryId: repo.id,
    headSha: pullRequest.headSha,
    reviewRunId,
  })
  await mkdir(path.dirname(paths.indexPath), { recursive: true })
  const cloneEnv = await cloneRepository({
    repo,
    pullRequest,
    installationId,
    paths,
  })

  const baseSha = await revParse(
    paths.repositoryPath,
    `origin/${pullRequest.baseRef}`
  )
  const codeIndex = await buildRepositoryCodeIndex({
    repository: paths.repositoryPath,
    changedFiles,
  })
  let basePromise: ReturnType<PreparedReviewRuntime["loadBase"]> | null = null
  const loadBase: PreparedReviewRuntime["loadBase"] = () =>
    (basePromise ??= (async () => {
      await execFileAsync(
        "git",
        [
          "worktree",
          "add",
          "--quiet",
          "--detach",
          paths.baseRepositoryPath,
          baseSha,
        ],
        {
          cwd: paths.repositoryPath,
          env: cloneEnv,
          maxBuffer: 20 * 1024 * 1024,
        }
      )
      const index = await buildRepositoryCodeIndex({
        repository: paths.baseRepositoryPath,
      })
      await writeFile(
        paths.baseIndexPath,
        JSON.stringify(serializeCodeIndex(index), null, 2),
        "utf8"
      )
      return { repositoryPath: paths.baseRepositoryPath, index }
    })())
  await writeFile(
    paths.indexPath,
    JSON.stringify(serializeCodeIndex(codeIndex), null, 2),
    "utf8"
  )
  await writeFile(
    paths.metadataPath,
    JSON.stringify(
      {
        reviewRunId,
        repositoryId: repo.id,
        repository: repo.fullName,
        pullRequestId: pullRequest.id,
        pullRequestNumber: pullRequest.number,
        baseRef: pullRequest.baseRef,
        baseSha,
        headSha: pullRequest.headSha,
        preparedAt: new Date().toISOString(),
      },
      null,
      2
    ),
    "utf8"
  )

  return {
    paths,
    codeIndex,
    baseSha,
    loadBase,
    qdrant: qdrantConfig(),
  }
}
