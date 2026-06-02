import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { GitForkIcon, RefreshCwIcon, SearchIcon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@workspace/ui/components/button"
import { Switch } from "@workspace/ui/components/switch"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { Input } from "@workspace/ui/components/input"
import { Separator } from "@workspace/ui/components/separator"
import { PageHeader } from "@/components/page-header"
import { useWorkspaceContext } from "@/contexts/workspace-context"
import { useRepositories } from "@/hooks/use-repositories"
import { useUpdateRepository } from "@/hooks/use-update-repository"
import { useSyncWorkspace } from "@/hooks/use-sync-workspace"
import { cn } from "@workspace/ui/lib/utils"

export const Route = createFileRoute("/_app/repositories/")({
  component: RepositoriesIndexRoute,
})

function RepositoriesIndexRoute() {
  const { selectedWorkspaceId } = useWorkspaceContext()

  if (!selectedWorkspaceId) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">
          Select an organization to view repositories
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader icon={GitForkIcon} title="Repositories" />

      <div className="flex-1 overflow-auto p-6">
        <RepositoriesList workspaceId={selectedWorkspaceId} />
      </div>
    </div>
  )
}

function RepositoriesList({ workspaceId }: { workspaceId: string }) {
  const { data: repos, isPending } = useRepositories(workspaceId)
  const updateRepo = useUpdateRepository(workspaceId)
  const syncWorkspace = useSyncWorkspace(workspaceId)
  const navigate = useNavigate()
  const [search, setSearch] = useState("")

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

  const filteredRepos = repos
    ?.filter((repo) => {
      const query = search.trim().toLowerCase()
      if (!query) return true
      return (
        repo.name.toLowerCase().includes(query) ||
        repo.fullName.toLowerCase().includes(query)
      )
    })
    .sort((a, b) => {
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1
      return a.name.localeCompare(b.name)
    })

  const enabledRepos = filteredRepos?.filter((repo) => repo.enabled) ?? []
  const disabledRepos = filteredRepos?.filter((repo) => !repo.enabled) ?? []

  const handleOpenRepo = (repositoryId: string) => {
    navigate({
      to: "/repositories/$repositoryId",
      params: { repositoryId },
    })
  }

  if (isPending && repos === undefined) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-lg" />
        ))}
      </div>
    )
  }

  if (!repos || repos.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <div className="flex size-12 items-center justify-center rounded-xl border border-border bg-muted">
          <GitForkIcon className="size-6 text-muted-foreground" />
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">No repositories found</p>
          <p className="text-xs text-muted-foreground">
            Sync to pull in repositories from your GitHub organization.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleSync}
          disabled={syncWorkspace.isPending}
        >
          <RefreshCwIcon
            className={cn("size-3.5", syncWorkspace.isPending && "animate-spin")}
          />
          {syncWorkspace.isPending ? "Syncing…" : "Sync"}
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="shrink-0 text-sm text-muted-foreground">
          {filteredRepos?.length ?? 0}{" "}
          {(filteredRepos?.length ?? 0) === 1 ? "repository" : "repositories"}
        </p>
        <div className="flex items-center gap-1.5">
          <div className="relative w-full max-w-xs">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search repositories…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 pl-8 text-sm"
            />
          </div>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={handleSync}
            disabled={syncWorkspace.isPending}
            title="Sync repositories"
          >
            <RefreshCwIcon
              className={cn("size-3.5", syncWorkspace.isPending && "animate-spin")}
            />
          </Button>
        </div>
      </div>

      {filteredRepos?.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-sm text-muted-foreground">
            No repositories match your search
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {enabledRepos.map((repo) => (
            <RepoRow
              key={repo.id}
              repo={repo}
              onOpen={() => handleOpenRepo(repo.id)}
              onToggle={(enabled) => handleToggle(repo.id, enabled)}
              toggleDisabled={updateRepo.isPending || repo.archived}
            />
          ))}

          {enabledRepos.length > 0 && disabledRepos.length > 0 && (
            <div className="py-1">
              <Separator />
              <p className="mt-3 mb-1 text-sm text-muted-foreground">
                Disabled
              </p>
            </div>
          )}

          {disabledRepos.map((repo) => (
            <RepoRow
              key={repo.id}
              repo={repo}
              onOpen={() => handleOpenRepo(repo.id)}
              onToggle={(enabled) => handleToggle(repo.id, enabled)}
              toggleDisabled={updateRepo.isPending || repo.archived}
            />
          ))}
        </div>
      )}
    </div>
  )
}

type Repo = NonNullable<ReturnType<typeof useRepositories>["data"]>[number]

function RepoRow({
  repo,
  onOpen,
  onToggle,
  toggleDisabled,
}: {
  repo: Repo
  onOpen: () => void
  onToggle: (enabled: boolean) => void
  toggleDisabled: boolean
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onOpen()
        }
      }}
      className={cn(
        "flex cursor-pointer items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        repo.archived && "opacity-50",
        !repo.enabled && "border-dashed"
      )}
    >
      <GitForkIcon className="size-4 shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={cn(
            "truncate text-sm font-medium",
            !repo.enabled && "text-muted-foreground"
          )}
          title={repo.fullName}
        >
          {repo.name}
        </span>
        {repo.archived && (
          <span className="text-xs text-muted-foreground">Archived</span>
        )}
      </div>
      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <Switch
          checked={repo.enabled}
          onCheckedChange={onToggle}
          disabled={toggleDisabled}
          aria-label={`${repo.enabled ? "Disable" : "Enable"} ${repo.name}`}
        />
      </div>
    </div>
  )
}
