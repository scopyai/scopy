import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { authClient } from "@/lib/auth-client"

export const workspaceAnalyticsRanges = [
  "this_week",
  "this_month",
  "last_30_days",
  "last_90_days",
  "all_time",
] as const

export type WorkspaceAnalyticsRange =
  (typeof workspaceAnalyticsRanges)[number]

type WorkspaceAnalyticsOptions = {
  range?: WorkspaceAnalyticsRange
  repositoryIds?: string[]
}

export function useWorkspaceAnalytics(
  workspaceId: string | null | undefined,
  options: WorkspaceAnalyticsOptions = {},
) {
  const { data: session } = authClient.useSession()
  const range = options.range ?? "last_30_days"
  const repositoryIds = options.repositoryIds ?? []

  return useQuery({
    queryKey: [
      "workspaces",
      workspaceId,
      "analytics",
      range,
      [...repositoryIds].sort(),
    ],
    queryFn: async () => {
      const { data, error } = await api
        .workspaces({ workspaceId: workspaceId! })
        .analytics.get({
          query: {
            range,
            ...(repositoryIds.length > 0
              ? { repositoryIds: repositoryIds.join(",") }
              : {}),
          },
        })

      if (error) throw error
      return data
    },
    enabled: !!session && !!workspaceId,
  })
}
