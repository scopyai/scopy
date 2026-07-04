export const billingKeys = {
  all: (workspaceId: string) =>
    ["workspaces", workspaceId, "billing"] as const,
  usage: (
    workspaceId: string,
    page: number,
    pageSize: number,
    billingMode: string,
  ) =>
    [
      ...billingKeys.all(workspaceId),
      "usage",
      page,
      pageSize,
      billingMode,
    ] as const,
  usageTrend: (workspaceId: string) =>
    [...billingKeys.all(workspaceId), "usage-trend"] as const,
  charges: (workspaceId: string, page: number, pageSize: number) =>
    [...billingKeys.all(workspaceId), "charges", page, pageSize] as const,
}
