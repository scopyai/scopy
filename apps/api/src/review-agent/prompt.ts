export const buildPullRequestSummaryPrompt = ({
  title,
  body,
  baseRef,
  headRef,
  diff,
}: {
  title: string
  body: string | null
  baseRef: string
  headRef: string
  diff: string
}) => `Summarize the changes made in this pull request.

Write concise markdown for the pull request author and reviewers.
Start with "## Summary".
Use a short introductory paragraph and a compact bullet list of the main changes.
Describe what changed, what it may affect, etc. Use only the code provided to you as context.

Pull request title: ${title}
Pull request description: ${body ?? "(none)"}
Base branch: ${baseRef}
Head branch: ${headRef}

Changed files:
${diff}`
