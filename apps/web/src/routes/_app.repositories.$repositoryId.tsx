import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { z } from "zod"
import { ExternalLinkIcon } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Separator } from "@workspace/ui/components/separator"
import { useWorkspaceContext } from "@/contexts/workspace-context"
import { useRepositories } from "@/hooks/use-repositories"
import { usePullRequests } from "@/hooks/use-pull-requests"
import { usePullRequest } from "@/hooks/use-pull-request"
import { PullRequestList } from "@/components/pull-requests/pr-list"
import { PullRequestDetail } from "@/components/pull-requests/pr-detail"

const searchSchema = z.object({
  pullRequestId: z.string().optional(),
})

export const Route = createFileRoute("/_app/repositories/$repositoryId")({
  validateSearch: searchSchema,
  component: RepositoryPage,
})

function RepositoryPage() {
  const { repositoryId } = Route.useParams()
  const { pullRequestId } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })

  const { selectedWorkspaceId } = useWorkspaceContext()
  const { data: repos } = useRepositories(selectedWorkspaceId)
  const repository = repos?.find((r) => r.id === repositoryId)

  const { data: pullRequests, isPending: pullRequestsPending } = usePullRequests(
    selectedWorkspaceId,
    repositoryId,
  )

  const { data: pullRequestDetail, isPending: detailPending } = usePullRequest(
    selectedWorkspaceId,
    repositoryId,
    pullRequestId,
  )

  const detailOpen = !!pullRequestId

  const handleSelectPullRequest = (id: string) => {
    navigate({ search: (prev) => ({ ...prev, pullRequestId: id }) })
  }

  const handleCloseDetail = () => {
    navigate({ search: (prev) => ({ ...prev, pullRequestId: undefined }) })
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Repo header */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {repository ? (
            <>
              <h1 className="truncate text-sm font-medium">{repository.fullName}</h1>
              {repository.archived && (
                <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                  Archived
                </span>
              )}
              {!repository.enabled && (
                <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                  Disabled
                </span>
              )}
            </>
          ) : (
            <div className="h-4 w-40 animate-pulse rounded bg-muted" />
          )}
        </div>
        {repository?.htmlUrl && (
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" asChild>
            <a href={repository.htmlUrl} target="_blank" rel="noopener noreferrer">
              GitHub
              <ExternalLinkIcon className="size-3" />
            </a>
          </Button>
        )}
      </div>

      {/* Two-panel body */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* PR list column */}
        <div
          className={
            detailOpen
              ? "flex w-80 shrink-0 flex-col overflow-hidden"
              : "flex flex-1 flex-col overflow-hidden"
          }
        >
          <PullRequestList
            pullRequests={pullRequests}
            isPending={pullRequestsPending}
            selectedPullRequestId={pullRequestId}
            onSelect={handleSelectPullRequest}
          />
        </div>

        {/* Separator between columns */}
        {detailOpen && <Separator orientation="vertical" className="h-full" />}

        {/* PR detail panel */}
        {detailOpen && (
          <div className="flex flex-1 flex-col overflow-hidden">
            <PullRequestDetail
              pullRequest={pullRequestDetail}
              isPending={detailPending}
              onClose={handleCloseDetail}
            />
          </div>
        )}
      </div>
    </div>
  )
}
