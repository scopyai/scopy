import { Navigate } from "@tanstack/react-router"
import { useWorkspaces } from "@/hooks/use-workspaces"
import { getWorkspaceSlug } from "@/lib/workspace-slug"

export function WorkspaceHomeRedirect() {
  const { data: workspaces, isPending } = useWorkspaces()

  if (isPending) return null

  if (!workspaces?.length) {
    return <Navigate to="/connect" replace />
  }

  return (
    <Navigate
      to="/$workspaceSlug/repositories"
      params={{ workspaceSlug: getWorkspaceSlug(workspaces[0].workspace) }}
      replace
    />
  )
}
