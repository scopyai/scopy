"use client"

import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { RefreshCwIcon, GitForkIcon, ChevronRightIcon } from "lucide-react"
import { useNavigate, useRouterState, Link } from "@tanstack/react-router"
import { Switch } from "@workspace/ui/components/switch"
import { Button } from "@workspace/ui/components/button"
import { useRepositories } from "@/hooks/use-repositories"
import { useUpdateRepository } from "@/hooks/use-update-repository"
import { useSyncWorkspace } from "@/hooks/use-sync-workspace"
import { cn } from "@workspace/ui/lib/utils"
import { toast } from "sonner"

const REPO_ROW_CLASS =
  "flex w-full items-center gap-2 rounded-md px-2 py-1.5"
const MORE_ROW_CLASS =
  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground"

interface RepoListProps {
  workspaceId: string
}

export function RepoList({ workspaceId }: RepoListProps) {
  const { data: repos, isPending } = useRepositories(workspaceId)
  const updateRepo = useUpdateRepository(workspaceId)
  const syncWorkspace = useSyncWorkspace(workspaceId)
  const navigate = useNavigate()

  const containerRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const rowMeasureRef = useRef<HTMLDivElement>(null)
  const moreMeasureRef = useRef<HTMLAnchorElement>(null)
  const [visibleLimit, setVisibleLimit] = useState(0)

  const activeRepositoryId = useRouterState({
    select: (s) => {
      const lastMatch = s.matches.at(-1)
      return (
        (lastMatch?.params as { repositoryId?: string })?.repositoryId ?? null
      )
    },
  })

  const updateVisibleLimit = useCallback(() => {
    const container = containerRef.current
    const header = headerRef.current
    const row = rowMeasureRef.current
    const more = moreMeasureRef.current
    if (!container || !header || !row) return

    const total = repos?.length ?? 0
    if (total === 0) {
      setVisibleLimit(0)
      return
    }

    const available = container.clientHeight - header.offsetHeight
    const rowHeight = row.offsetHeight
    const moreHeight = more?.offsetHeight ?? 0

    if (rowHeight <= 0) return

    const maxWithoutMore = Math.floor(available / rowHeight)
    if (maxWithoutMore >= total) {
      setVisibleLimit(total)
      return
    }

    const maxWithMore = Math.floor((available - moreHeight) / rowHeight)
    setVisibleLimit(Math.max(0, maxWithMore))
  }, [repos?.length])

  useLayoutEffect(() => {
    updateVisibleLimit()

    const container = containerRef.current
    if (!container) return

    const observer = new ResizeObserver(() => updateVisibleLimit())
    observer.observe(container)

    return () => observer.disconnect()
  }, [updateVisibleLimit])

  const handleSync = async () => {
    try {
      const result = await syncWorkspace.mutateAsync()
      toast.success(`Synced ${result?.synced ?? 0} repositories`)
    } catch {
      toast.error("Failed to sync repositories")
    }
  }

  const handleToggle = async (repositoryId: string, enabled: boolean) => {
    try {
      await updateRepo.mutateAsync({ repositoryId, enabled })
    } catch {
      toast.error("Failed to update repository")
    }
  }

  const handleRepoClick = (repositoryId: string) => {
    navigate({ to: "/repositories/$repositoryId", params: { repositoryId } })
  }

  const visibleRepos = repos?.slice(0, visibleLimit)
  const hiddenCount = repos ? Math.max(0, repos.length - visibleLimit) : 0

  return (
    <div
      ref={containerRef}
      className="flex h-full min-h-0 flex-1 flex-col overflow-hidden"
    >
      <div
        ref={headerRef}
        className="flex shrink-0 items-center justify-between px-3 py-2"
      >
        <Link
          to="/repositories"
          className="group flex items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          Repositories
          <ChevronRightIcon className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
        </Link>
        <Button
          variant="ghost"
          size="sm"
          className="size-6 p-0"
          onClick={handleSync}
          disabled={syncWorkspace.isPending}
          title="Sync repositories"
        >
          <RefreshCwIcon
            className={cn(
              "size-3.5",
              syncWorkspace.isPending && "animate-spin"
            )}
          />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden px-2 pb-1">
        {isPending && repos === undefined ? (
          <div className="py-4" aria-busy="true" />
        ) : !repos || repos.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <div className="flex size-9 items-center justify-center rounded-lg border border-border bg-muted">
              <GitForkIcon className="size-4 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">
              No repositories found
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={handleSync}
              className="text-sm"
            >
              Sync now
            </Button>
          </div>
        ) : (
          <>
            {visibleRepos?.map((repo) => (
              <div
                key={repo.id}
                className={cn(
                  "group transition-colors hover:bg-accent/50",
                  REPO_ROW_CLASS,
                  repo.archived && "opacity-50",
                  activeRepositoryId === repo.id && "bg-accent"
                )}
              >
                <button
                  type="button"
                  onClick={() => handleRepoClick(repo.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <GitForkIcon className="size-4 shrink-0 text-muted-foreground" />
                  <span
                    className={cn(
                      "truncate text-sm",
                      repo.enabled ? "text-foreground" : "text-muted-foreground"
                    )}
                    title={repo.fullName}
                  >
                    {repo.name}
                  </span>
                </button>
                <Switch
                  checked={repo.enabled}
                  onCheckedChange={(checked) => handleToggle(repo.id, checked)}
                  disabled={updateRepo.isPending || repo.archived}
                  className="scale-75"
                  aria-label={`${repo.enabled ? "Disable" : "Enable"} ${repo.name}`}
                />
              </div>
            ))}
            {hiddenCount > 0 && (
              <Link
                to="/repositories"
                className={cn(
                  "transition-colors hover:bg-accent/50 hover:text-foreground",
                  MORE_ROW_CLASS
                )}
              >
                + {hiddenCount} more
              </Link>
            )}
          </>
        )}
      </div>

      <div
        aria-hidden
        className="pointer-events-none fixed top-0 left-[-9999px] z-[-1] w-[236px] opacity-0"
      >
        <div ref={rowMeasureRef} className={REPO_ROW_CLASS}>
          <GitForkIcon className="size-4 shrink-0" />
          <span className="truncate text-sm">measure</span>
          <Switch className="scale-75" checked disabled tabIndex={-1} />
        </div>
        <Link ref={moreMeasureRef} to="/repositories" className={MORE_ROW_CLASS}>
          + 99 more
        </Link>
      </div>
    </div>
  )
}
