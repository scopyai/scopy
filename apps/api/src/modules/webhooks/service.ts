import { eq } from "drizzle-orm"
import { db } from "../../db/client"
import { workspace } from "../../db/schema"
import { jobs } from "../../jobs/definitions"
import { schedulePullRequestReview } from "../reviews/service"
import { handleGitHubWebhook, type GitHubWebhookPayload } from "./github"

const findWorkspaceByInstallationId = async (installationId?: number) => {
  if (!installationId) {
    return null
  }

  return (
    (await db.query.workspace.findFirst({
      where: eq(workspace.providerInstallationId, String(installationId)),
    })) ?? null
  )
}

export const runGitHubWebhook = async ({
  deliveryId,
  eventName,
  payload,
}: {
  deliveryId: string
  eventName: string
  payload: GitHubWebhookPayload
}) => {
  const relatedWorkspace = await findWorkspaceByInstallationId(
    payload.installation?.id
  )
  const review = await handleGitHubWebhook({
    deliveryId,
    eventName,
    payload,
    relatedWorkspace,
  })

  if (!review) {
    return
  }

  const reviewRunId = await db.transaction((tx) =>
    schedulePullRequestReview(tx, {
      deliveryId,
      ...review,
    })
  )
  await jobs.reviewPullRequest.enqueue({ reviewRunId })
}
