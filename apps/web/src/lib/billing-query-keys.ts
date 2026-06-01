export const billingKeys = {
  all: (workspaceId: string) =>
    ["workspaces", workspaceId, "billing"] as const,
  credits: (workspaceId: string, page: number, pageSize: number) =>
    [...billingKeys.all(workspaceId), "credits", page, pageSize] as const,
}
