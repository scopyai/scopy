"use client"

import { RefreshCwIcon, GitForkIcon } from "lucide-react"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { Switch } from "@workspace/ui/components/switch"
import { Button } from "@workspace/ui/components/button"
import { useRepositories } from "@/hooks/use-repositories"
import { useUpdateRepository } from "@/hooks/use-update-repository"
import { useSyncWorkspace } from "@/hooks/use-sync-workspace"
import { cn } from "@workspace/ui/lib/utils"
import { toast } from "sonner"

interface RepoListProps {
  workspaceId: string
}

export function RepoList({ workspaceId }: RepoListProps) {
  const { data: repos, isPending } = useRepositories(workspaceId)
  const updateRepo = useUpdateRepository(workspaceId)
  const syncWorkspace = useSyncWorkspace(workspaceId)

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

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Repositories
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="size-6 p-0"
          onClick={handleSync}
          disabled={syncWorkspace.isPending}
          title="Sync repositories"
        >
          <RefreshCwIcon
            className={cn("size-3.5", syncWorkspace.isPending && "animate-spin")}
          />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="px-2 pb-2">
          {isPending ? (
            <div className="space-y-1">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-2 rounded-md px-2 py-1.5">
                  <Skeleton className="size-3.5 rounded-sm" />
                  <Skeleton className="h-3.5 flex-1" />
                  <Skeleton className="h-4 w-8 rounded-full" />
                </div>
              ))}
            </div>
          ) : !repos || repos.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <GitForkIcon className="size-8 text-muted-foreground/50" />
              <p className="text-xs text-muted-foreground">No repositories found</p>
              <Button variant="outline" size="sm" onClick={handleSync} className="text-xs">
                Sync now
              </Button>
            </div>
          ) : (
            repos.map((repo) => (
              <div
                key={repo.id}
                className={cn(
                  "group flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-accent/50",
                  repo.archived && "opacity-50"
                )}
              >
                <GitForkIcon className="size-3.5 shrink-0 text-muted-foreground" />
                <span
                  className={cn(
                    "flex-1 truncate text-xs",
                    repo.enabled ? "text-foreground" : "text-muted-foreground"
                  )}
                  title={repo.fullName}
                >
                  {repo.name}
                </span>
                <Switch
                  checked={repo.enabled}
                  onCheckedChange={(checked) => handleToggle(repo.id, checked)}
                  disabled={updateRepo.isPending || repo.archived}
                  className="scale-75"
                  aria-label={`${repo.enabled ? "Disable" : "Enable"} ${repo.name}`}
                />
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
