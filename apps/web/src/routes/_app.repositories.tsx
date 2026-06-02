import { createFileRoute } from "@tanstack/react-router"
import { GitForkIcon, SearchIcon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { Switch } from "@workspace/ui/components/switch"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { Input } from "@workspace/ui/components/input"
import { PageHeader } from "@/components/page-header"
import { useWorkspaceContext } from "@/contexts/workspace-context"
import { useRepositories } from "@/hooks/use-repositories"
import { useUpdateRepository } from "@/hooks/use-update-repository"
import { cn } from "@workspace/ui/lib/utils"

export const Route = createFileRoute("/_app/repositories")({
  component: RepositoriesRoute,
})

function RepositoriesRoute() {
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
  const [search, setSearch] = useState("")

  const handleToggle = async (repositoryId: string, enabled: boolean) => {
    try {
      await updateRepo.mutateAsync({ repositoryId, enabled })
    } catch {
      toast.error("Failed to update repository")
    }
  }

  const filteredRepos = repos?.filter((repo) => {
    const query = search.trim().toLowerCase()
    if (!query) return true
    return (
      repo.name.toLowerCase().includes(query) ||
      repo.fullName.toLowerCase().includes(query)
    )
  })

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
            Repositories from your GitHub organization will appear here.
          </p>
        </div>
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
      </div>

      {filteredRepos?.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-sm text-muted-foreground">
            No repositories match your search
          </p>
        </div>
      ) : (
        filteredRepos?.map((repo) => (
          <div
            key={repo.id}
            className={cn(
              "flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 transition-colors",
              repo.archived && "opacity-50"
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
            <Switch
              checked={repo.enabled}
              onCheckedChange={(checked) => handleToggle(repo.id, checked)}
              disabled={updateRepo.isPending || repo.archived}
              aria-label={`${repo.enabled ? "Disable" : "Enable"} ${repo.name}`}
            />
          </div>
        ))
      )}
    </div>
  )
}
