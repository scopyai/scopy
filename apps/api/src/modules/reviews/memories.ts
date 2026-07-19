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
  action: z
    .enum(["noop", "create", "update", "retract", "clarify"])
    .describe("The single action to take for the newest reply."),
  memoryId: z
    .string()
    .nullable()
    .describe(
      "For update or retract: the id of the existing memory to change, copied exactly from the list. Null otherwise."
    ),
  rule: z
    .string()
    .nullable()
    .describe(
      "For create or update: one short unconditional instruction to the reviewer, starting with a verb such as 'Do not flag' or 'Flag', naming its subject concretely. No conditions, no 'when' or 'if' clauses. Null otherwise."
    ),
  reason: z
    .string()
    .nullable()
    .describe(
      "For create or update: the facts from the human's reply that justify the rule, stated as established facts about this repository. Null otherwise."
    ),
  reply: z
    .string()
    .nullable()
    .describe(
      "A very short, natural response to post in the thread: confirm what you did, or ask the clarifying question. Null for noop."
    ),
})

const distillInstructions = [
  "You maintain long-term memories for an AI code reviewer.",
  "You are given one review finding the reviewer posted on a pull request, the discussion thread under it, and the repository's existing memories.",
  "Based only on the newest human reply, choose exactly one action:",
  "- noop: no durable guidance, or it is already covered by an existing memory. A reply that narrows, broadens, or corrects the scope of an existing memory is never noop: it is an update.",
  "- create: the reply states durable guidance not covered by any existing memory: a dismissal with a reason, a factual correction, or a team convention or preference. A reply that explains why a finding does not apply, such as facts about the deployment or infrastructure, is a dismissal with a reason even when it is not phrased as an instruction.",
  "- update: the reply refines or corrects one existing memory, for example narrowing, broadening, or rewording it. Set memoryId and the full replacement rule and reason.",
  "- retract: the reply withdraws the guidance an existing memory records, so the reviewer should return to its default behavior. Set memoryId. Never choose update to invert a memory into what the reviewer already does by default, such as flagging real issues: withdrawing guidance is always retract.",
  "- clarify: durable intent is likely, but which memory it targets or what it should say is ambiguous. Ask one short question and change nothing.",
  "Rules:",
  "- Acknowledgements, questions, jokes, fix confirmations, bare disagreements without a reason, and remarks that only apply to this one pull request are noop.",
  "- Record the human's position faithfully, never your own judgement of the finding, even if you disagree with it.",
  "- Address the rule to the reviewer, telling it what to flag or not flag, not to the team about how to build the code.",
  "- Treat what the human states as established fact about this repository, not as a condition for the reviewer to verify: rules are unconditional and the human's reason is only context.",
  "- Never fold the reason into the rule as a condition: a rule shaped like 'Do not flag X when Y' is wrong. The rule is only 'Do not flag X' and Y belongs in the reason.",
  "- State rules at the same generality as the human's guidance: when they dismiss a whole class of issues, the rule covers that class, not the specifics of one finding.",
  "- Memories are read by a reviewer that has never seen this conversation. Never write references like 'this webhook', 'this endpoint', or 'here': resolve them into concrete details from the finding, such as the file path, route, or function, so the rule identifies its subject on its own.",
  "- When the reply states guidance that a disabled memory already records, choose update for that memory rather than create or noop, so it becomes active again.",
  "- Change at most one memory. When the reply affects several, choose clarify.",
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

  const pullNumber = Number(reply.pull_request_url.split("/").pop())
  const pullComments = await octokit.paginate(
    "GET /repos/{owner}/{repo}/pulls/{pull_number}/comments",
    {
      owner: repo.owner,
      repo: repo.name,
      pull_number: pullNumber,
      per_page: 100,
    }
  )
  const root = pullComments.find(
    (comment) => comment.id === reply.in_reply_to_id
  )
  const finding = root && parseFindingMarker(root.body)
  if (!finding) return

  const stripMarker = (body: string) =>
    body.replace(/<!-- scopy:finding [A-Za-z0-9_-]+ -->/g, "").trim()
  const thread = pullComments.filter(
    (comment) => comment.in_reply_to_id === root.id && comment.id !== commentId
  )

  const memories = await db.query.reviewMemory.findMany({
    where: eq(reviewMemory.repositoryId, repo.id),
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
      ...(thread.length > 0
        ? [
            "",
            "Earlier replies in this thread:",
            ...thread.map(
              (comment) =>
                `${comment.user.type === "Bot" ? "you (the reviewer)" : `@${comment.user.login}`}: ${stripMarker(comment.body)}`
            ),
          ]
        : []),
      "",
      `Newest reply, from @${reply.user.login} (act on this one):`,
      reply.body,
      "",
      ...(memories.length > 0
        ? [
            "Existing memories for this repository:",
            ...memories.map(
              (memory) =>
                `- id ${memory.id}${memory.enabled ? "" : " (disabled)"}: ${memory.content}`
            ),
          ]
        : ["There are no existing memories for this repository."]),
    ].join("\n"),
    maxRetries: 2,
  })

  const target = object.memoryId
    ? memories.find((memory) => memory.id === object.memoryId)
    : undefined
  const now = new Date()
  const content = object.rule
    ? `${object.rule.trim().replace(/[.\s]+$/, "")}.${object.reason ? ` Reason: ${object.reason.trim()}` : ""}`
    : null

  if (object.action === "noop") {
    logger.info("Review memory distillation skipped reply", {
      repositoryId,
      commentId,
    })
    return
  }
  if ((object.action === "update" || object.action === "retract") && !target) {
    logger.info("Review memory action skipped: unknown target memory", {
      repositoryId,
      commentId,
      action: object.action,
      memoryId: object.memoryId,
    })
    return
  }
  if (
    (object.action === "create" || object.action === "update") &&
    !content
  ) {
    logger.info("Review memory action skipped: missing content", {
      repositoryId,
      commentId,
      action: object.action,
    })
    return
  }

  if (object.action === "create") {
    await db
      .insert(reviewMemory)
      .values({
        id: randomUUID(),
        repositoryId: repo.id,
        content: replaceEmDashes(content!),
        sourceCommentId: String(commentId),
        sourceCommentUrl: reply.html_url,
      })
      .onConflictDoUpdate({
        target: reviewMemory.sourceCommentId,
        set: {
          content: replaceEmDashes(content!),
          pathGlob: null,
          updatedAt: now,
        },
      })
  } else if (object.action === "update") {
    await db
      .update(reviewMemory)
      .set({
        content: replaceEmDashes(content!),
        enabled: true,
        sourceCommentUrl: reply.html_url,
        updatedAt: now,
      })
      .where(eq(reviewMemory.id, target!.id))
  } else if (object.action === "retract") {
    await db
      .update(reviewMemory)
      .set({ enabled: false, updatedAt: now })
      .where(eq(reviewMemory.id, target!.id))
  }
  logger.info("Review memory action applied", {
    repositoryId,
    commentId,
    action: object.action,
    memoryId: target?.id,
  })

  const fallbackReply =
    object.action === "retract"
      ? "Got it, I removed that memory."
      : content
        ? `Noted, I will remember this:\n\n> ${content}`
        : null
  const replyBody = object.reply ?? fallbackReply
  if (!replyBody) return

  try {
    await octokit.request(
      "POST /repos/{owner}/{repo}/pulls/{pull_number}/comments/{comment_id}/replies",
      {
        owner: repo.owner,
        repo: repo.name,
        pull_number: pullNumber,
        comment_id: commentId,
        body: replaceEmDashes(replyBody),
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
