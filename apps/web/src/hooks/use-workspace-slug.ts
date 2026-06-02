import { useParams } from "@tanstack/react-router"
import { findWorkspaceBySlug } from "@/lib/workspace-slug"
import { useWorkspaces } from "@/hooks/use-workspaces"

export function useWorkspaceSlug() {
  const { workspaceSlug } = useParams({ strict: false })
  const { data: workspaces, isPending } = useWorkspaces()
  const entry = findWorkspaceBySlug(workspaces, workspaceSlug)

  return {
    workspaceSlug,
    workspaceId: entry?.workspace.id ?? null,
    workspace: entry?.workspace ?? null,
    workspaces,
    isPending,
  }
}
