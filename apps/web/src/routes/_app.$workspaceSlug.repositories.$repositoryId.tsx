import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useCallback, useRef, useState } from "react"
import { z } from "zod"
import { useWorkspaceContext } from "@/contexts/workspace-context"
import { useRepositories } from "@/hooks/use-repositories"
import { usePullRequests } from "@/hooks/use-pull-requests"
import { usePullRequest } from "@/hooks/use-pull-request"
import { PullRequestList } from "@/components/pull-requests/pr-list"
import { PullRequestDetail } from "@/components/pull-requests/pr-detail"

const searchSchema = z.object({
  pullRequestId: z.string().optional(),
})

export const Route = createFileRoute("/_app/$workspaceSlug/repositories/$repositoryId")({
  validateSearch: searchSchema,
  component: RepositoryPage,
})

const MIN_LIST_WIDTH = 240
const MAX_LIST_WIDTH = 600
const DEFAULT_LIST_WIDTH = 320

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

  const [listWidth, setListWidth] = useState(DEFAULT_LIST_WIDTH)
  const containerRef = useRef<HTMLDivElement>(null)
  const isResizing = useRef(false)

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isResizing.current = true
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"

    const onMouseMove = (e: MouseEvent) => {
      if (!isResizing.current || !containerRef.current) return
      const containerLeft = containerRef.current.getBoundingClientRect().left
      const newWidth = e.clientX - containerLeft
      setListWidth(Math.max(MIN_LIST_WIDTH, Math.min(MAX_LIST_WIDTH, newWidth)))
    }

    const onMouseUp = () => {
      isResizing.current = false
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      document.removeEventListener("mousemove", onMouseMove)
      document.removeEventListener("mouseup", onMouseUp)
    }

    document.addEventListener("mousemove", onMouseMove)
    document.addEventListener("mouseup", onMouseUp)
  }, [])

  const handleSelectPullRequest = (id: string) => {
    navigate({ search: (prev) => ({ ...prev, pullRequestId: id }) })
  }

  const handleCloseDetail = () => {
    navigate({ search: (prev) => ({ ...prev, pullRequestId: undefined }) })
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* h-14 matches sidebar workspace-switcher: h-14 border-b on both keeps borders at the same y-position */}
      <div className="flex h-14 shrink-0 items-center border-b border-border px-4">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {repository ? (
            <>
              <a
                href={repository.htmlUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 max-w-full truncate text-sm font-medium underline-offset-2 hover:underline"
              >
                {repository.fullName}
              </a>
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
      </div>

      {/* Two-panel body */}
      <div ref={containerRef} className="flex min-h-0 flex-1 overflow-hidden">
        {/* PR list column */}
        <div
          style={detailOpen ? { width: listWidth } : undefined}
          className={
            detailOpen
              ? "flex shrink-0 flex-col overflow-hidden"
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

        {/* Draggable resize handle — wide hit area (16px) with a 1px visual line centered */}
        {detailOpen && (
          <div
            className="group relative flex w-4 shrink-0 cursor-col-resize items-stretch justify-center"
            onMouseDown={startResize}
          >
            <div className="w-px bg-border transition-colors group-hover:bg-primary/50" />
          </div>
        )}

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
