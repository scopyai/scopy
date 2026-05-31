# Pull Request Dashboard

## Purpose

The dashboard provides a lightweight view of the pull requests tracked by the
application. The primary review experience remains on GitHub. This UI is meant
to show which repositories and pull requests are being processed and to provide
a basic readable PR discussion view.

## Repository Behavior

- A repository is tracked only while it is enabled in the dashboard.
- Enabling a repository imports all currently open GitHub pull requests.
- Disabling a repository stops further PR updates. Existing local data is kept.
- Re-enabling a repository fetches the current state from GitHub again and
  updates existing local records.
- If GitHub App access to a repository is removed, local repository and PR data
  is preserved but the repository is hidden from the normal repository list (soft delete).
- The default repository list excludes repositories no longer accessible
  through the GitHub App. A maintenance UI may request unavailable repositories
  by passing `includeUnavailable=true`.

## Pull Request List

When the user selects a repository, show its locally stored pull requests.

Each PR snapshot includes:

- PR number
- Title and body Markdown
- GitHub URL
- Author
- State: `open`, `closed`, or `merged`
- Draft status
- Base branch, head branch, and head commit SHA
- Labels and assignees
- Opened, closed, merged, provider-updated, and last-synced timestamps

Closed and merged PRs remain available after tracking them. The UI should
prioritize open PRs visually, but historical tracked PRs can still be displayed.

## Pull Request Details

Selecting a PR should show its snapshot and a chronological lightweight
timeline. The dashboard does not need to reproduce GitHub's full PR interface.

Timeline event types:

- `lifecycle`: PR opened, closed, reopened, merged, marked ready for review, or
  converted back to draft.
- `issue_comment`: General PR discussion comment.
- `review`: Review submission, such as approved, changes requested, or
  commented.
- `review_comment`: Inline diff comment or reply.

Timeline events include an `action`, optional author, optional body Markdown,
optional GitHub URL, timestamps, and type-specific `metadata`.

For inline diff comments, render a compact entry. The metadata may include file
path, line information, a diff hunk, and reply relationship. A full diff viewer
is not required. Link to GitHub when the user needs the complete code context.

Deleted upstream comments remain represented as tombstones. Their bodies are
omitted from normal API responses, so the UI can render a simple deleted-comment
placeholder.

## Synchronization Model

- Webhooks are the normal synchronization mechanism.
- The dashboard reads local database state and should not refetch GitHub data
  whenever a repository or PR page is opened.
- Initial hydration happens when repository tracking is enabled.
- A manual PR sync endpoint exists as a recovery action for missed webhook
  deliveries. It should be exposed only through a secondary or maintenance menu,
  not as a primary dashboard action.

## API Endpoints

All endpoints are authenticated and scoped to a workspace and repository.

### List pull requests

```text
GET /workspaces/:workspaceId/repositories/:repositoryId/pull-requests
```

Returns locally tracked PR snapshots ordered by latest provider update.

### Get pull request details

```text
GET /workspaces/:workspaceId/repositories/:repositoryId/pull-requests/:pullRequestId
```

Returns a PR snapshot with a `timeline` array ordered chronologically.

### Manually synchronize pull requests

```text
POST /workspaces/:workspaceId/repositories/:repositoryId/pull-requests/sync
```

This is an owner/admin recovery action. It imports currently open PRs and
refreshes locally known PRs. It returns:

```json
{
  "synced": 3
}
```

### List repositories

```text
GET /workspaces/:workspaceId/repositories
```

By default, repositories removed from GitHub App access are hidden. For a future
maintenance view:

```text
GET /workspaces/:workspaceId/repositories?includeUnavailable=true
```
