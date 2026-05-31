import type { TaskList } from "graphile-worker"
import { processGitHubWebhook } from "./process-github-webhook"
import { reviewPullRequest } from "./review-pull-request"

export const taskList: TaskList = {
  process_github_webhook: processGitHubWebhook,
  review_pull_request: reviewPullRequest,
}
