import { Navigate } from "@tanstack/react-router"
import { LoadError } from "@/components/load-error"
import { useWorkspaces } from "@/hooks/use-workspaces"
import { getActiveWorkspaces } from "@/lib/workspace-slug"

export function WorkspaceHomeRedirect() {
  const { data: workspaces, isPending, isError, refetch } = useWorkspaces()

  if (isPending) return null

  if (isError) {
    return (
      <LoadError
        message="Failed to load organizations"
        onRetry={() => void refetch()}
        fullScreen
      />
    )
  }

  const active = getActiveWorkspaces(workspaces)

  if (!active.length) {
    return <Navigate to="/connect" replace />
  }

  return (
    <Navigate
      to="/$workspaceSlug/repositories"
      params={{ workspaceSlug: active[0].workspace.providerAccountLogin }}
      replace
    />
  )
}
