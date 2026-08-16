import { Outlet, createFileRoute, Navigate } from "@tanstack/react-router"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { useEffect } from "react"
import { LoadError } from "@/components/load-error"
import { useWorkspaceContext } from "@/contexts/workspace-context"
import {
  findActiveWorkspaceBySlug,
  getActiveWorkspaces,
} from "@/lib/workspace-slug"
import { useWorkspaces } from "@/hooks/use-workspaces"

export const Route = createFileRoute("/_app/$workspaceSlug")({
  component: WorkspaceLayout,
})

function WorkspaceLayout() {
  const { workspaceSlug } = Route.useParams()
  const { data: workspaces, isPending, isError, refetch } = useWorkspaces()
  const { setSelectedWorkspaceId } = useWorkspaceContext()

  const entry = findActiveWorkspaceBySlug(workspaces, workspaceSlug)

  useEffect(() => {
    setSelectedWorkspaceId(entry?.workspace.id ?? null)
  }, [entry?.workspace.id, setSelectedWorkspaceId])

  if (isPending) {
    return (
      <div className="h-full overflow-hidden px-4 py-6 sm:px-6 sm:py-10">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
          <div className="flex flex-col gap-3">
            <Skeleton className="h-7 w-64" />
            <Skeleton className="h-4 w-full max-w-lg" />
          </div>
          <Skeleton className="h-10 w-full" />
          <div className="flex flex-col gap-3">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-[74px] w-full rounded-md" />
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <LoadError
        message="Failed to load organizations"
        onRetry={() => void refetch()}
      />
    )
  }

  const active = getActiveWorkspaces(workspaces)

  if (!entry && active.length > 0) {
    const fallback = active[0]
    return (
      <Navigate
        to="/$workspaceSlug/repositories"
        params={{ workspaceSlug: fallback.workspace.providerAccountLogin }}
        replace
      />
    )
  }

  if (!entry) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">
          No organizations connected
        </p>
      </div>
    )
  }

  return <Outlet />
}
