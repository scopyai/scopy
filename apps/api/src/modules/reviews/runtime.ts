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
  indexPath: string
  metadataPath: string
}

export type PreparedReviewRuntime = {
  paths: ReviewRuntimePaths
  codeIndex: Awaited<ReturnType<typeof buildRepositoryCodeIndex>>
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
    safeSegment(reviewRunId),
  )

  return {
    runPath,
    repositoryPath: path.join(runPath, "repo"),
    indexPath: path.join(runPath, "index", "ast.json"),
    metadataPath: path.join(runPath, "metadata.json"),
  }
}

const createAskPassScript = async (runPath: string) => {
  const scriptPath = path.join(runPath, "git-askpass.sh")
  await writeFile(
    scriptPath,
    [
      "#!/bin/sh",
      "case \"$1\" in",
      "  *Username*) printf '%s\\n' 'x-access-token' ;;",
      "  *) printf '%s\\n' \"$REVIEW_GITHUB_TOKEN\" ;;",
      "esac",
      "",
    ].join("\n"),
    "utf8",
  )
  await chmod(scriptPath, 0o700)
  return scriptPath
}

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
  const token = await createGitHubInstallationAccessToken(installationId)
  const askPass = await createAskPassScript(paths.runPath)
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
      env: {
        ...process.env,
        GIT_ASKPASS: askPass,
        GIT_TERMINAL_PROMPT: "0",
        REVIEW_GITHUB_TOKEN: token,
      },
      maxBuffer: 20 * 1024 * 1024,
    },
  )
  await execFileAsync(
    "git",
    ["fetch", "--quiet", "origin", `pull/${pullRequest.number}/head`],
    {
      cwd: paths.repositoryPath,
      env: {
        ...process.env,
        GIT_ASKPASS: askPass,
        GIT_TERMINAL_PROMPT: "0",
        REVIEW_GITHUB_TOKEN: token,
      },
      maxBuffer: 20 * 1024 * 1024,
    },
  )
  await execFileAsync("git", ["checkout", "--quiet", pullRequest.headSha], {
    cwd: paths.repositoryPath,
    env: {
      ...process.env,
      GIT_ASKPASS: askPass,
      GIT_TERMINAL_PROMPT: "0",
      REVIEW_GITHUB_TOKEN: token,
    },
    maxBuffer: 20 * 1024 * 1024,
  })
}

const serializeCodeIndex = (
  index: Awaited<ReturnType<typeof buildRepositoryCodeIndex>>,
) => ({
  repository: index.repository,
  repositoryFiles: index.repositoryFiles,
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
}: {
  reviewRunId: string
  repo: Repository
  pullRequest: PullRequest
  installationId: string
}): Promise<PreparedReviewRuntime> => {
  const paths = getReviewRuntimePaths({
    repositoryId: repo.id,
    headSha: pullRequest.headSha,
    reviewRunId,
  })
  await mkdir(path.dirname(paths.indexPath), { recursive: true })
  await cloneRepository({ repo, pullRequest, installationId, paths })

  const codeIndex = await buildRepositoryCodeIndex({
    repository: paths.repositoryPath,
  })
  await writeFile(
    paths.indexPath,
    JSON.stringify(serializeCodeIndex(codeIndex), null, 2),
    "utf8",
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
        headSha: pullRequest.headSha,
        preparedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf8",
  )

  return {
    paths,
    codeIndex,
    qdrant: qdrantConfig(),
  }
}
