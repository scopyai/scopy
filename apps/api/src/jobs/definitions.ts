import {
  IdempotencyCollisionError,
  type JsonObject,
  type RunOpts,
  type WorkflowDeclaration,
} from "@hatchet-dev/typescript-sdk/v1"
import { z } from "zod"
import { hatchet } from "./client"

export const jobNames = {
  processGitHubWebhook: "process-github-webhook",
  reviewPullRequest: "review-pull-request",
  crawlDocSource: "crawl-doc-source",
  distillReviewMemory: "distill-review-memory",
  syncRepositoryPullRequests: "sync-repository-pull-requests",
} as const

export const jobPayloadSchemas = {
  processGitHubWebhook: z.object({
    deliveryId: z.string().min(1),
    eventName: z.string().min(1),
    payload: z.record(z.string(), z.json()),
  }),
  reviewPullRequest: z.object({
    reviewRunId: z.uuid(),
  }),
  crawlDocSource: z.object({
    sourceId: z.string().min(1),
  }),
  distillReviewMemory: z.object({
    repositoryId: z.string().min(1),
    commentId: z.number().int().positive(),
  }),
  syncRepositoryPullRequests: z.object({
    repositoryId: z.string().min(1),
  }),
}

export type GitHubWebhookJobInput = z.infer<
  typeof jobPayloadSchemas.processGitHubWebhook
>

const createJob = <Input extends JsonObject>(
  name: string,
  schema: z.ZodType<Input>
) => {
  const workflow: WorkflowDeclaration<Input, {}, {}> = hatchet.workflow<Input>({
    name,
  })

  return {
    enqueue: async (payload: Input, options?: RunOpts) => {
      const input = schema.parse(payload)
      try {
        const ref = await workflow.runNoWait(input, options)
        return await ref.getWorkflowRunId()
      } catch (error) {
        if (error instanceof IdempotencyCollisionError) {
          return error.existingRunExternalId
        }
        throw error
      }
    },
  }
}

export const jobs = {
  processGitHubWebhook: createJob(
    jobNames.processGitHubWebhook,
    jobPayloadSchemas.processGitHubWebhook
  ),
  reviewPullRequest: createJob(
    jobNames.reviewPullRequest,
    jobPayloadSchemas.reviewPullRequest
  ),
  crawlDocSource: createJob(
    jobNames.crawlDocSource,
    jobPayloadSchemas.crawlDocSource
  ),
  distillReviewMemory: createJob(
    jobNames.distillReviewMemory,
    jobPayloadSchemas.distillReviewMemory
  ),
  syncRepositoryPullRequests: createJob(
    jobNames.syncRepositoryPullRequests,
    jobPayloadSchemas.syncRepositoryPullRequests
  ),
}
