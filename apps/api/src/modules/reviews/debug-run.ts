import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import type { pullRequest, repository } from "../../db/schema"
import { env } from "../../env"

type Repository = typeof repository.$inferSelect
type PullRequest = typeof pullRequest.$inferSelect

type RecorderInput = {
  reviewRunId: string
  repo: Repository
  pullRequest: PullRequest
  triggerSource: string
  modelId: string
}

type EventRecord = {
  at: string
  name: string
  data?: unknown
}

const safeSegment = (value: string) => value.replace(/[^A-Za-z0-9_.-]/g, "_")
const runsDir = () => env.REVIEW_RUNS_DIR ?? ".runs"
const byteLength = (value: unknown) =>
  Buffer.byteLength(
    JSON.stringify(value, createJsonReplacer()) ?? "undefined",
    "utf8",
  )

const recordKeys = (value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value)
    : []

const pickStats = (value: unknown) =>
  value &&
  typeof value === "object" &&
  "stats" in value &&
  value.stats &&
  typeof value.stats === "object"
    ? value.stats
    : undefined

const createJsonReplacer = () => {
  const seen = new WeakSet<object>()
  return (_key: string, value: unknown) => {
    if (typeof value === "bigint") return value.toString()
    if (value instanceof Map) return Object.fromEntries(value)
    if (value instanceof Set) return [...value]
    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: value.stack,
      }
    }
    if (value && typeof value === "object") {
      if (seen.has(value)) return "[Circular]"
      seen.add(value)
    }
    return value
  }
}

const stringifyJson = (value: unknown) =>
  `${JSON.stringify(value, createJsonReplacer(), 2)}\n`

export const getReviewDebugRunPath = ({
  reviewRunId,
  repo,
  pullRequest,
}: Pick<RecorderInput, "reviewRunId" | "repo" | "pullRequest">) =>
  path.resolve(
    runsDir(),
    safeSegment(repo.id),
    `pr-${pullRequest.number}-${safeSegment(pullRequest.headSha.slice(0, 12))}`,
    safeSegment(reviewRunId),
  )

export const createReviewRunRecorder = async (input: RecorderInput) => {
  const runPath = getReviewDebugRunPath(input)
  const toolsPath = path.join(runPath, "tools")
  const stepsPath = path.join(runPath, "steps")
  let toolCallCount = 0
  let stepCount = 0
  let artifactCount = 0

  await mkdir(toolsPath, { recursive: true })
  await mkdir(stepsPath, { recursive: true })

  const appendJsonl = async (relativePath: string, value: unknown) => {
    await writeFile(
      path.join(runPath, relativePath),
      `${JSON.stringify(value, createJsonReplacer())}\n`,
      { encoding: "utf8", flag: "a" },
    )
  }

  const writeText = async (relativePath: string, content: string) => {
    const absolutePath = path.join(runPath, relativePath)
    await mkdir(path.dirname(absolutePath), { recursive: true })
    await writeFile(absolutePath, content, "utf8")
    artifactCount += 1
    await appendJsonl("artifacts.jsonl", {
      at: new Date().toISOString(),
      index: artifactCount,
      path: relativePath,
      kind: relativePath.endsWith(".json") ? "json" : "text",
      bytes: Buffer.byteLength(content, "utf8"),
    })
  }

  const writeJson = async (relativePath: string, value: unknown) => {
    await writeText(relativePath, stringifyJson(value))
  }

  const appendEvent = async (name: string, data?: unknown) => {
    const event: EventRecord = { at: new Date().toISOString(), name, data }
    await appendJsonl("events.jsonl", event)
  }

  await writeJson("metadata.json", {
    reviewRunId: input.reviewRunId,
    triggerSource: input.triggerSource,
    modelId: input.modelId,
    repository: {
      id: input.repo.id,
      fullName: input.repo.fullName,
      owner: input.repo.owner,
      name: input.repo.name,
      private: input.repo.private,
      defaultBranch: input.repo.defaultBranch,
    },
    pullRequest: {
      id: input.pullRequest.id,
      number: input.pullRequest.number,
      title: input.pullRequest.title,
      body: input.pullRequest.body,
      baseRef: input.pullRequest.baseRef,
      headRef: input.pullRequest.headRef,
      headSha: input.pullRequest.headSha,
      draft: input.pullRequest.draft,
      state: input.pullRequest.state,
      htmlUrl: input.pullRequest.htmlUrl,
    },
    startedAt: new Date().toISOString(),
    runPath,
  })
  await appendEvent("run.created", { runPath })

  return {
    runPath,
    writeText,
    writeJson,
    appendEvent,
    recordToolCall: async ({
      name,
      input,
      output,
    }: {
      name: string
      input: unknown
      output: unknown
    }) => {
      toolCallCount += 1
      const prefix = `tools/${String(toolCallCount).padStart(3, "0")}-${safeSegment(name)}`
      await writeJson(`${prefix}.input.json`, input)
      await writeJson(`${prefix}.output.json`, output)
      await appendJsonl("tool-calls.jsonl", {
        at: new Date().toISOString(),
        index: toolCallCount,
        name,
        inputBytes: byteLength(input),
        outputBytes: byteLength(output),
        inputKeys: recordKeys(input),
        outputKeys: recordKeys(output),
        outputStats: pickStats(output),
      })
      await appendEvent("tool.completed", { name, index: toolCallCount })
    },
    recordStep: async (step: unknown) => {
      stepCount += 1
      await writeJson(
        `steps/${String(stepCount).padStart(3, "0")}.json`,
        step,
      )
      const stepRecord =
        step && typeof step === "object"
          ? (step as Record<string, unknown>)
          : {}
      await appendJsonl("steps.jsonl", {
        at: new Date().toISOString(),
        index: stepCount,
        finishReason: stepRecord.finishReason,
        usage: stepRecord.usage,
        textBytes:
          typeof stepRecord.text === "string"
            ? Buffer.byteLength(stepRecord.text, "utf8")
            : undefined,
        toolCalls: Array.isArray(stepRecord.toolCalls)
          ? stepRecord.toolCalls.length
          : undefined,
        toolResults: Array.isArray(stepRecord.toolResults)
          ? stepRecord.toolResults.length
          : undefined,
      })
      await appendEvent("agent.step.completed", { index: stepCount })
    },
    counts: () => ({
      artifacts: artifactCount,
      toolCalls: toolCallCount,
      steps: stepCount,
    }),
  }
}

export type ReviewRunRecorder = Awaited<
  ReturnType<typeof createReviewRunRecorder>
>
