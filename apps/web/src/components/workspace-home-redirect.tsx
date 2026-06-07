import { Navigate } from "@tanstack/react-router"
import { useWorkspaces } from "@/hooks/use-workspaces"
import { getActiveWorkspaces, getWorkspaceSlug } from "@/lib/workspace-slug"

export function WorkspaceHomeRedirect() {
  const { data: workspaces, isPending } = useWorkspaces()

  if (isPending) return null

  const active = getActiveWorkspaces(workspaces)

  if (!active.length) {
    return <Navigate to="/connect" replace />
  }

  return (
    <Navigate
      to="/$workspaceSlug/repositories"
      params={{ workspaceSlug: getWorkspaceSlug(active[0].workspace) }}
      replace
    />
  )
}
