type WorkspaceLike = {
  id: string
  providerAccountLogin: string
}

type WorkspaceEntry = {
  workspace: WorkspaceLike
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
