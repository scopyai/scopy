type WorkspaceLike = {
  id: string
  providerAccountLogin: string
}

type WorkspaceEntry = {
  workspace: WorkspaceLike
  status?: string
}

/** URL segment for a workspace (GitHub org login, e.g. `acme-corp`). */
export function getWorkspaceSlug(workspace: WorkspaceLike) {
  return workspace.providerAccountLogin
}

export function findWorkspaceBySlug(
  workspaces: WorkspaceEntry[] | undefined,
  slug: string | undefined
) {
  if (!workspaces || !slug) return undefined
  return workspaces.find((entry) => getWorkspaceSlug(entry.workspace) === slug)
}

export function findWorkspaceById(
  workspaces: WorkspaceEntry[] | undefined,
  workspaceId: string | undefined
) {
  if (!workspaces || !workspaceId) return undefined
  return workspaces.find((entry) => entry.workspace.id === workspaceId)
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
