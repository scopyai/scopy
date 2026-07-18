import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useCallback, useRef, useState } from "react"
import { ArrowLeftIcon, GitPullRequestIcon, Settings2Icon } from "lucide-react"
import { z } from "zod"
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { useWorkspaceContext } from "@/contexts/workspace-context"
import { useRepositories } from "@/hooks/use-repositories"
import { usePullRequests } from "@/hooks/use-pull-requests"
import { usePullRequest } from "@/hooks/use-pull-request"
import { useWorkspaces } from "@/hooks/use-workspaces"
import { PullRequestList } from "@/components/pull-requests/pr-list"
import { PullRequestDetail } from "@/components/pull-requests/pr-detail"
import { RepositoryReviewSettings } from "@/components/repositories/repository-review-settings"

const searchSchema = z.object({
  pullRequestId: z.string().optional(),
  view: z.enum(["pull-requests", "settings"]).default("pull-requests"),
})

export const Route = createFileRoute(
  "/_app/$workspaceSlug/repositories/$repositoryId"
)({
  validateSearch: searchSchema,
  component: RepositoryPage,
})

const MIN_LIST_WIDTH = 240
const MAX_LIST_WIDTH = 600
const DEFAULT_LIST_WIDTH = 320

function RepositoryPage() {
  const { repositoryId } = Route.useParams()
  const { pullRequestId, view } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })

  const { selectedWorkspaceId } = useWorkspaceContext()
  const { data: workspaces } = useWorkspaces()
  const { data: repos } = useRepositories(selectedWorkspaceId)
  const repository = repos?.find((r) => r.id === repositoryId)

  const selectedEntry = workspaces?.find(
    (entry) => entry.workspace.id === selectedWorkspaceId
  )
  const canEditSettings =
    selectedEntry?.role === "owner" || selectedEntry?.role === "admin"

  const { data: pullRequests, isPending: pullRequestsPending } =
    usePullRequests(selectedWorkspaceId, repositoryId)

  const { data: pullRequestDetail, isPending: detailPending } = usePullRequest(
    selectedWorkspaceId,
    repositoryId,
    pullRequestId
  )

  const showSettings = view === "settings"
  const detailOpen = !!pullRequestId && !showSettings

  const [listWidth, setListWidth] = useState(DEFAULT_LIST_WIDTH)
  const containerRef = useRef<HTMLDivElement>(null)
  const isResizing = useRef(false)

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isResizing.current = true
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"

    const onMouseMove = (event: MouseEvent) => {
      if (!isResizing.current || !containerRef.current) return
      const containerLeft = containerRef.current.getBoundingClientRect().left
      const newWidth = event.clientX - containerLeft
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
    navigate({
      search: (prev) => ({ ...prev, pullRequestId: id, view: "pull-requests" }),
    })
  }

  const handleCloseDetail = () => {
    navigate({ search: (prev) => ({ ...prev, pullRequestId: undefined }) })
  }

  const handleViewChange = (nextView: "pull-requests" | "settings") => {
    navigate({
      search: (prev) => ({
        ...prev,
        view: nextView,
        pullRequestId: nextView === "settings" ? undefined : prev.pullRequestId,
      }),
    })
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 flex-col gap-3 border-b border-border px-4 py-3 md:h-14 md:flex-row md:items-center md:gap-2 md:py-0">
        <div
          className={cn(
            "relative flex w-full min-w-0 flex-1 items-center gap-2",
            detailOpen && "pl-10 lg:pl-0"
          )}
        >
          {detailOpen && (
            <div className="absolute top-1/2 -left-2 -translate-y-1/2 lg:hidden">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-10 active:not-aria-[haspopup]:translate-y-0"
                onClick={handleCloseDetail}
                aria-label="Back to pull requests"
              >
                <ArrowLeftIcon className="size-4" />
              </Button>
            </div>
          )}

          <div
            className={cn(
              "flex min-w-0 items-center gap-2",
              detailOpen
                ? "ml-auto justify-end lg:ml-0 lg:flex-1 lg:justify-start"
                : "flex-1"
            )}
          >
            {repository ? (
              <>
                <a
                  href={repository.htmlUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="max-w-full min-w-0 truncate text-sm font-medium underline-offset-2 hover:underline"
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

        {!detailOpen && (
          <div className="flex w-full shrink-0 items-center gap-1 rounded-lg border border-border p-0.5 md:w-auto">
            <RepositoryViewTab
              active={!showSettings}
              onClick={() => handleViewChange("pull-requests")}
              icon={GitPullRequestIcon}
              label="Pull requests"
            />
            <RepositoryViewTab
              active={showSettings}
              onClick={() => handleViewChange("settings")}
              icon={Settings2Icon}
              label="Settings"
            />
          </div>
        )}
      </div>

      {showSettings && selectedWorkspaceId ? (
        <RepositoryReviewSettings
          workspaceId={selectedWorkspaceId}
          repositoryId={repositoryId}
          repositoryEnabled={repository?.enabled ?? false}
          canEdit={canEditSettings}
        />
      ) : (
        <div ref={containerRef} className="flex min-h-0 flex-1 overflow-hidden">
          <div
            style={detailOpen ? { width: listWidth } : undefined}
            className={
              detailOpen
                ? "hidden shrink-0 flex-col overflow-hidden lg:flex"
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

          {detailOpen && (
            <div
              className="group relative hidden w-4 shrink-0 cursor-col-resize items-stretch justify-center lg:flex"
              onMouseDown={startResize}
            >
              <div className="w-px bg-border transition-colors group-hover:bg-primary/50" />
            </div>
          )}

          {detailOpen && (
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
              <PullRequestDetail
                pullRequest={pullRequestDetail}
                isPending={detailPending}
                onClose={handleCloseDetail}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function RepositoryViewTab({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: React.ComponentType<{ className?: string }>
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-1 items-center justify-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors md:flex-none",
        active
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:text-foreground"
      )}
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  )
}
