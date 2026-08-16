import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { GitForkIcon, RefreshCwIcon, SearchIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { z } from "zod"
import { Button } from "@workspace/ui/components/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { Input } from "@workspace/ui/components/input"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@workspace/ui/components/item"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { Spinner } from "@workspace/ui/components/spinner"
import { Switch } from "@workspace/ui/components/switch"
import { cn } from "@workspace/ui/lib/utils"
import { PageHeader } from "@/components/page-header"
import { LoadError } from "@/components/load-error"
import { useWorkspaceContext } from "@/contexts/workspace-context"
import { useRepositories } from "@/hooks/use-repositories"
import { useUpdateRepository } from "@/hooks/use-update-repository"
import { useSyncWorkspace } from "@/hooks/use-sync-workspace"

const searchSchema = z.object({
  connected: z.union([z.literal("1"), z.literal(1)]).optional(),
})

export const Route = createFileRoute("/_app/$workspaceSlug/repositories/")({
  validateSearch: searchSchema,
  component: RepositoriesIndexRoute,
})

function RepositoriesIndexRoute() {
  const { workspaceSlug } = Route.useParams()
  const { connected } = Route.useSearch()
  const navigate = useNavigate()
  const { selectedWorkspaceId } = useWorkspaceContext()

  useEffect(() => {
    if (!connected) return

    toast.success("Organization connected successfully")
    navigate({
      to: "/$workspaceSlug/repositories",
      params: { workspaceSlug },
      search: {},
      replace: true,
    })
  }, [connected, navigate, workspaceSlug])

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

      <div className="flex-1 overflow-auto p-4 sm:p-6">
        <RepositoriesList
          workspaceId={selectedWorkspaceId}
          workspaceSlug={workspaceSlug}
        />
      </div>
    </div>
  )
}

function RepositoriesList({
  workspaceId,
  workspaceSlug,
}: {
  workspaceId: string
  workspaceSlug: string
}) {
  const { data: repos, isPending, isError, refetch } =
    useRepositories(workspaceId)
  const updateRepo = useUpdateRepository(workspaceId)
  const syncWorkspace = useSyncWorkspace(workspaceId)
  const [search, setSearch] = useState("")

  const handleSync = async () => {
    try {
      const result = await syncWorkspace.mutateAsync()
      toast.success(`Synced ${result.synced} repositories`)
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

  const filteredRepos = (repos ?? [])
    .filter((repo) => {
      const query = search.trim().toLowerCase()
      if (!query) return true
      return (
        repo.name.toLowerCase().includes(query) ||
        repo.fullName.toLowerCase().includes(query)
      )
    })
    .sort((a, b) => a.fullName.localeCompare(b.fullName))

  const enabledRepos = filteredRepos.filter((repo) => repo.enabled)

  if (isPending) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
        <Skeleton className="h-10 w-full" />
        <div className="flex flex-col gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-md" />
          ))}
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <LoadError
        message="Failed to load repositories"
        onRetry={() => void refetch()}
      />
    )
  }

  if (repos.length === 0) {
    return (
      <div className="mx-auto w-full max-w-5xl">
        <Empty className="min-h-96 border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <GitForkIcon />
            </EmptyMedia>
            <EmptyTitle>No repositories found</EmptyTitle>
            <EmptyDescription>
              Sync to pull in repositories from your GitHub organization.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              variant="outline"
              onClick={handleSync}
              disabled={syncWorkspace.isPending}
            >
              {syncWorkspace.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <RefreshCwIcon data-icon="inline-start" />
              )}
              {syncWorkspace.isPending ? "Syncing..." : "Sync repositories"}
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          {filteredRepos.length}{" "}
          {filteredRepos.length === 1 ? "repository" : "repositories"}
          {search ? " found" : ""} · {enabledRepos.length} active
        </p>
        <div className="flex min-w-0 gap-2 sm:w-80">
          <div className="relative min-w-0 flex-1">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search repositories..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={handleSync}
            disabled={syncWorkspace.isPending}
            aria-label="Sync repositories with GitHub"
            title="Sync repositories with GitHub"
          >
            {syncWorkspace.isPending ? <Spinner /> : <RefreshCwIcon />}
          </Button>
        </div>
      </div>

      {filteredRepos.length === 0 ? (
        <Empty className="min-h-72 border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchIcon />
            </EmptyMedia>
            <EmptyTitle>No matching repositories</EmptyTitle>
            <EmptyDescription>
              Try a different repository name or owner.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ItemGroup className="gap-2">
          {filteredRepos.map((repo) => (
            <RepoRow
              key={repo.id}
              repo={repo}
              workspaceSlug={workspaceSlug}
              onToggle={(enabled) => handleToggle(repo.id, enabled)}
              toggleDisabled={updateRepo.isPending || repo.archived}
            />
          ))}
        </ItemGroup>
      )}
    </div>
  )
}

type Repo = NonNullable<ReturnType<typeof useRepositories>["data"]>[number]

function RepoRow({
  repo,
  workspaceSlug,
  onToggle,
  toggleDisabled,
}: {
  repo: Repo
  workspaceSlug: string
  onToggle: (enabled: boolean) => void
  toggleDisabled: boolean
}) {
  return (
    <Item
      role="listitem"
      variant="outline"
      className={cn(
        "relative flex-nowrap gap-0 overflow-hidden rounded-lg bg-card p-0 transition-[border-color,box-shadow] has-[a:hover]:border-ring/60 has-[a:focus-visible]:border-ring has-[a:focus-visible]:ring-[3px] has-[a:focus-visible]:ring-ring/50",
        repo.archived && "opacity-60"
      )}
    >
      <div
        aria-hidden
        className={cn(
          "absolute inset-y-0 left-0 w-1",
          repo.enabled ? "bg-primary" : "bg-muted-foreground/20"
        )}
      />
      <Link
        to="/$workspaceSlug/repositories/$repositoryId"
        params={{ workspaceSlug, repositoryId: repo.id }}
        search={{ view: "pull-requests" }}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 py-3 pr-3 pl-5 outline-none hover:bg-muted/50 focus-visible:bg-muted/50"
      >
        <ItemMedia variant="icon">
          <GitForkIcon className="text-muted-foreground" />
        </ItemMedia>
        <ItemContent className="min-w-0">
          <ItemTitle className="w-full">
            <span className="truncate" title={repo.fullName}>
              {repo.fullName}
            </span>
            {repo.archived && (
              <span className="text-xs font-normal text-muted-foreground">
                Archived
              </span>
            )}
          </ItemTitle>
        </ItemContent>
      </Link>
      <ItemActions className="shrink-0 self-stretch border-l px-3 sm:px-4">
        <Switch
          checked={repo.enabled}
          onCheckedChange={onToggle}
          disabled={toggleDisabled}
          aria-label={`${repo.enabled ? "Disable" : "Enable"} ${repo.name}`}
        />
      </ItemActions>
    </Item>
  )
}
