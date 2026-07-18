type WorkspaceLike = {
  id: string
  providerAccountLogin: string
}

type WorkspaceEntry = {
  workspace: WorkspaceLike
  status?: string
}

export function getWorkspaceSlug(workspace: WorkspaceLike) {
  return workspace.providerAccountLogin
}

export function getActiveWorkspaces<T extends WorkspaceEntry>(
  workspaces: T[] | undefined
): T[] {
  if (!workspaces) return []
  return workspaces.filter((e) => e.status === "active")
}

export function getPendingWorkspaces<T extends WorkspaceEntry>(
  workspaces: T[] | undefined
): T[] {
  if (!workspaces) return []
  return workspaces.filter((e) => e.status === "pending")
}

export function findActiveWorkspaceBySlug<T extends WorkspaceEntry>(
  workspaces: T[] | undefined,
  slug: string | undefined
): T | undefined {
  if (!workspaces || !slug) return undefined
  return getActiveWorkspaces(workspaces).find(
    (entry) => getWorkspaceSlug(entry.workspace) === slug
  )
}
