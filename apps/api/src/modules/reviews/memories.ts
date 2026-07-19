import { randomUUID } from "node:crypto"
import { generateObject } from "ai"
import { eq } from "drizzle-orm"
import { z } from "zod"
import { db } from "../../db/client"
import { repository, reviewMemory } from "../../db/schema"
import { createGitHubApp } from "../github/service"
import { createReviewLlm, reviewModels } from "./llm"
import { replaceEmDashes } from "./text"

export type FindingMarkerData = {
  file: string
  startLine: number
  endLine: number
  severity: string
  title: string
  body: string
}

export const renderFindingMarker = ({
  file,
  startLine,
  endLine,
  severity,
  title,
  body,
}: FindingMarkerData) => {
  const data = { file, startLine, endLine, severity, title, body }
  const encoded = Buffer.from(JSON.stringify(data)).toString("base64url")
  return `<!-- scopy:finding ${encoded} -->`
}

export const parseFindingMarker = (body: string): FindingMarkerData | null => {
  const match = body.match(/<!-- scopy:finding ([A-Za-z0-9_-]+) -->/)
  if (!match) return null
  try {
    return JSON.parse(Buffer.from(match[1]!, "base64url").toString("utf8"))
  } catch {
    return null
  }
}

const memoryOutputSchema = z.object({
  memory: z
    .string()
    .min(1)
    .nullable()
    .describe(
      "One short imperative rule the reviewer should apply in future reviews, including the reason, or null when the reply contains no durable guidance."
    ),
  reply: z
    .string()
    .nullable()
    .describe(
      'A very short, natural acknowledgement to post as the reviewer\'s reply when a memory is saved, e.g. "Got it, I won\'t flag SSRF here anymore." Null when the memory is null.'
    ),
})

const distillInstructions = [
  "You maintain long-term memories for an AI code reviewer.",
  "You are given one review finding the reviewer posted on a pull request and a human reply to it.",
  "Decide whether the reply contains durable guidance the reviewer should remember for future reviews of this repository: a dismissal with a reason, a factual correction, or a stated team convention or preference.",
  "Acknowledgements, questions, jokes, fix confirmations, and remarks that only apply to this one pull request are not durable guidance; return a null memory for those.",
  "A bare disagreement without a reason is not durable guidance either.",
  "The memory must faithfully record the human's position, never your own judgement of the finding: when the reply dismisses the finding with a reason, the memory instructs the reviewer not to raise that kind of finding and records the human's reason, even if you disagree with it.",
  "Treat what the human states as established fact about this repository, not as a condition for the reviewer to verify: the rule is unconditional and the human's reason is only context.",
  "State the rule at the same generality as the human's guidance: when they dismiss a whole class of issues, the memory covers that class, not the specifics of this one finding.",
  "When there is durable guidance, phrase the memory as one short imperative rule with its reason, understandable without seeing this conversation.",
  "When the guidance is already covered by an existing memory, return a null memory.",
].join("\n")

export const distillReviewMemory = async ({
  repositoryId,
  commentId,
  logger,
}: {
  repositoryId: string
  commentId: number
  logger: {
    info: (message: string, meta?: Record<string, unknown>) => void
    error: (message: string, meta?: Record<string, unknown>) => void
  }
}) => {
  const repo = await db.query.repository.findFirst({
    where: eq(repository.id, repositoryId),
    with: { workspace: true },
  })
  if (!repo) return

  const octokit = await createGitHubApp().getInstallationOctokit(
    Number(repo.workspace.providerInstallationId)
  )
  const getComment = async (id: number) => {
    try {
      const response = await octokit.request(
        "GET /repos/{owner}/{repo}/pulls/comments/{comment_id}",
        { owner: repo.owner, repo: repo.name, comment_id: id }
      )
      return response.data
    } catch (error) {
      if ((error as { status?: number }).status === 404) return null
      throw error
    }
  }

  const reply = await getComment(commentId)
  if (!reply?.body || !reply.in_reply_to_id || reply.user.type === "Bot") return
  const parent = await getComment(reply.in_reply_to_id)
  const finding = parent && parseFindingMarker(parent.body)
  if (!finding) return

  const existingMemories = await db.query.reviewMemory.findMany({
    where: eq(reviewMemory.repositoryId, repo.id),
    columns: { content: true },
  })
  const llm = createReviewLlm()
  const { object } = await generateObject({
    model: llm.chatModel(reviewModels.subagent),
    schema: memoryOutputSchema,
    system: distillInstructions,
    prompt: [
      "Finding:",
      `File: ${finding.file}:${finding.startLine}-${finding.endLine}`,
      `Severity: ${finding.severity}`,
      `Title: ${finding.title}`,
      finding.body,
      "",
      `Reply from @${reply.user.login}:`,
      reply.body,
      ...(existingMemories.length > 0
        ? [
            "",
            "Existing memories:",
            ...existingMemories.map((memory) => `- ${memory.content}`),
          ]
        : []),
    ].join("\n"),
    maxRetries: 2,
  })

  if (!object.memory) {
    logger.info("Review memory distillation skipped reply", {
      repositoryId,
      commentId,
    })
    return
  }

  await db
    .insert(reviewMemory)
    .values({
      id: randomUUID(),
      workspaceId: repo.workspaceId,
      repositoryId: repo.id,
      content: replaceEmDashes(object.memory),
      sourceCommentId: String(commentId),
      sourceCommentUrl: reply.html_url,
    })
    .onConflictDoUpdate({
      target: reviewMemory.sourceCommentId,
      set: {
        content: replaceEmDashes(object.memory),
        pathGlob: null,
        updatedAt: new Date(),
      },
    })
  logger.info("Review memory saved", { repositoryId, commentId })

  try {
    await octokit.request(
      "POST /repos/{owner}/{repo}/pulls/{pull_number}/comments/{comment_id}/replies",
      {
        owner: repo.owner,
        repo: repo.name,
        pull_number: Number(reply.pull_request_url.split("/").pop()),
        comment_id: commentId,
        body: replaceEmDashes(
          object.reply ?? `Noted, I will remember this:\n\n> ${object.memory}`
        ),
      }
    )
  } catch (error) {
    logger.error("Failed to post review memory acknowledgement", {
      repositoryId,
      commentId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
