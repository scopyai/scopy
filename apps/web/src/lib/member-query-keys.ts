export const memberKeys = {
  all: (workspaceId: string) =>
    ["workspaces", workspaceId, "members"] as const,
}
