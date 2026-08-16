type WorkspaceLike = {
  id: string
  providerAccountLogin: string
}

type WorkspaceEntry = {
  workspace: WorkspaceLike
  status?: string
}

export function getActiveWorkspaces<T extends WorkspaceEntry>(
  workspaces: T[] | undefined
): T[] {
  return workspaces?.filter((entry) => entry.status === "active") ?? []
}

export function getPendingWorkspaces<T extends WorkspaceEntry>(
  workspaces: T[] | undefined
): T[] {
  return workspaces?.filter((entry) => entry.status === "pending") ?? []
}

export function findPreferredActiveWorkspace<T extends WorkspaceEntry>(
  workspaces: T[] | undefined,
  id: string | null | undefined
): T | undefined {
  const active = getActiveWorkspaces(workspaces)
  return active.find((entry) => entry.workspace.id === id) ?? active[0]
}

export function findActiveWorkspaceBySlug<T extends WorkspaceEntry>(
  workspaces: T[] | undefined,
  slug: string | undefined
): T | undefined {
  if (!slug) return undefined
  return getActiveWorkspaces(workspaces).find(
    (entry) => entry.workspace.providerAccountLogin === slug
  )
}
