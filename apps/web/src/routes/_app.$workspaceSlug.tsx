import { Outlet, createFileRoute, Navigate } from "@tanstack/react-router"
import { useEffect } from "react"
import { useWorkspaceContext } from "@/contexts/workspace-context"
import {
  getWorkspaceSlug,
  findActiveWorkspaceBySlug,
  getActiveWorkspaces,
} from "@/lib/workspace-slug"
import { useWorkspaces } from "@/hooks/use-workspaces"

export const Route = createFileRoute("/_app/$workspaceSlug")({
  component: WorkspaceLayout,
})

function WorkspaceLayout() {
  const { workspaceSlug } = Route.useParams()
  const { data: workspaces, isPending } = useWorkspaces()
  const { setSelectedWorkspaceId } = useWorkspaceContext()

  const entry = findActiveWorkspaceBySlug(workspaces, workspaceSlug)

  useEffect(() => {
    setSelectedWorkspaceId(entry?.workspace.id ?? null)
  }, [entry?.workspace.id, setSelectedWorkspaceId])

  if (isPending) return null

  const active = getActiveWorkspaces(workspaces)

  if (!entry && active.length > 0) {
    const fallback = active[0]
    return (
      <Navigate
        to="/$workspaceSlug/repositories"
        params={{ workspaceSlug: getWorkspaceSlug(fallback.workspace) }}
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
