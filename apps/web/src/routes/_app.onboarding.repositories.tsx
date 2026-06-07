import { useMutation, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { Switch } from "@workspace/ui/components/switch"
import { Input } from "@workspace/ui/components/input"
import { CheckIcon, SearchIcon } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { api } from "@/lib/api"
import { useRepositories } from "@/hooks/use-repositories"
import { useWorkspaces } from "@/hooks/use-workspaces"
import { hasSeenOnboardingOverview } from "@/lib/onboarding-flow"
import { getActiveWorkspaces, getWorkspaceSlug } from "@/lib/workspace-slug"

export const Route = createFileRoute("/_app/onboarding/repositories")({
  component: OnboardingRepositoriesPage,
})

function OnboardingRepositoriesPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: workspaces, isPending: workspacesPending } = useWorkspaces()
  const activeWorkspace = getActiveWorkspaces(workspaces).at(0)?.workspace
  const { data: repositories, isPending: repositoriesPending } =
    useRepositories(activeWorkspace?.id)
  const [selectedRepositoryIds, setSelectedRepositoryIds] = useState<string[]>(
    []
  )
  const [search, setSearch] = useState("")

  const availableRepositories = useMemo(
    () => repositories?.filter((repo) => !repo.providerAccessRemovedAt) ?? [],
    [repositories]
  )

  const filteredRepositories = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return availableRepositories

    return availableRepositories.filter(
      (repo) =>
        repo.name.toLowerCase().includes(query) ||
        repo.fullName.toLowerCase().includes(query)
    )
  }, [availableRepositories, search])

  useEffect(() => {
    if (!hasSeenOnboardingOverview()) {
      navigate({ to: "/onboarding/overview", replace: true })
    }
  }, [navigate])

  useEffect(() => {
    if (!availableRepositories.length) return
    setSelectedRepositoryIds((current) =>
      current.length ? current : availableRepositories.map((repo) => repo.id)
    )
  }, [availableRepositories])

  const completeOnboarding = useMutation({
    mutationFn: async () => {
      if (!activeWorkspace) throw new Error("Workspace is required")

      const { data, error } = await api
        .workspaces({ workspaceId: activeWorkspace.id })
        .onboarding.repositories.post({
          repositoryIds: selectedRepositoryIds,
        })

      if (error) throw error
      return data
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["me", "user"] }),
        queryClient.invalidateQueries({
          queryKey: ["workspaces", activeWorkspace?.id, "repositories"],
        }),
      ])

      if (activeWorkspace) {
        navigate({
          to: "/$workspaceSlug/repositories",
          params: { workspaceSlug: getWorkspaceSlug(activeWorkspace) },
          replace: true,
        })
      }
    },
    onError: () => {
      toast.error("Failed to save repository selection")
    },
  })

  if (workspacesPending) return <RepositorySelectionSkeleton />
  if (!activeWorkspace) return <Navigate to="/onboarding/connect" replace />

  const isLoading = repositoriesPending
  const canContinue =
    !completeOnboarding.isPending &&
    !isLoading &&
    (availableRepositories.length === 0 || selectedRepositoryIds.length > 0)

  const toggleRepository = (repositoryId: string, enabled: boolean) => {
    setSelectedRepositoryIds((current) =>
      enabled
        ? [...new Set([...current, repositoryId])]
        : current.filter((id) => id !== repositoryId)
    )
  }

  const allSelected =
    availableRepositories.length > 0 &&
    selectedRepositoryIds.length === availableRepositories.length

  const toggleSelectAll = () => {
    setSelectedRepositoryIds(
      allSelected ? [] : availableRepositories.map((repo) => repo.id)
    )
  }

  return (
    <div className="flex h-full min-h-0 justify-center px-6 py-10">
      <div className="flex min-h-0 w-full min-w-0 max-w-3xl flex-col gap-6">
        <div className="flex shrink-0 flex-col gap-2">
          <p className="text-sm font-medium text-muted-foreground">
            Step 3 of 3
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            Enable repositories for review
          </h1>
          <p className="text-sm text-muted-foreground">
            Choose the repositories where review should run. You can change this
            later from repository settings.
          </p>
        </div>

        <Card className="flex min-h-0 min-w-0 flex-1 flex-col">
          <CardHeader className="shrink-0">
            <div className="flex items-center justify-between gap-4">
              <div className="flex min-w-0 flex-col gap-1">
                <CardTitle className="truncate">{activeWorkspace.name}</CardTitle>
                <CardDescription>
                  {selectedRepositoryIds.length} of{" "}
                  {availableRepositories.length} selected
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={toggleSelectAll}
                disabled={!availableRepositories.length}
              >
                {allSelected ? "Clear" : "Select all"}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
            {!isLoading && availableRepositories.length > 0 ? (
              <div className="sticky top-0 z-10 bg-card pb-4">
                <div className="relative min-w-0">
                  <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type="search"
                    placeholder="Search repositories…"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    className="h-8 pl-8 text-sm"
                  />
                </div>
              </div>
            ) : null}
            {isLoading ? (
              <RepositoryListSkeleton />
            ) : availableRepositories.length ? (
              filteredRepositories.length ? (
                <div className="flex min-w-0 flex-col divide-y divide-border">
                  {filteredRepositories.map((repo) => {
                    const checked = selectedRepositoryIds.includes(repo.id)

                    return (
                      <label
                        key={repo.id}
                        className="flex min-w-0 cursor-pointer items-center justify-between gap-4 py-3"
                      >
                        <span className="flex min-w-0 flex-1 flex-col gap-1">
                          <span className="truncate text-sm font-medium">
                            {repo.fullName}
                          </span>
                          <span className="truncate text-xs text-muted-foreground">
                            {repo.private ? "Private" : "Public"}
                            {repo.defaultBranch
                              ? ` - ${repo.defaultBranch}`
                              : ""}
                          </span>
                        </span>
                        <Switch
                          className="shrink-0"
                          checked={checked}
                          onCheckedChange={(enabled) =>
                            toggleRepository(repo.id, enabled)
                          }
                          aria-label={`Enable ${repo.fullName}`}
                        />
                      </label>
                    )
                  })}
                </div>
              ) : (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No repositories match your search.
                </p>
              )
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No repositories are available from this GitHub installation.
              </p>
            )}
          </CardContent>
        </Card>

        <div className="flex shrink-0 justify-end">
          <Button
            onClick={() => completeOnboarding.mutate()}
            disabled={!canContinue}
          >
            {completeOnboarding.isPending ? (
              "Saving..."
            ) : (
              <>
                <CheckIcon data-icon="inline-start" />
                Continue to dashboard
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}

function RepositorySelectionSkeleton() {
  return (
    <div className="flex h-full justify-center px-6 py-10">
      <div className="flex w-full max-w-3xl flex-col gap-6">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-80 w-full" />
      </div>
    </div>
  )
}

function RepositoryListSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: 5 }).map((_, index) => (
        <Skeleton key={index} className="h-12 w-full" />
      ))}
    </div>
  )
}
