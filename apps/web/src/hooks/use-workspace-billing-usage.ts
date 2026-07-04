import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { authClient } from "@/lib/auth-client"
import { billingKeys } from "@/lib/billing-query-keys"

export function useWorkspaceBillingUsage(
  workspaceId: string | null | undefined,
  page = 1,
  pageSize = 25,
  billingMode?: "platform" | "byok",
) {
  const { data: session } = authClient.useSession()

  return useQuery({
    queryKey: billingKeys.usage(
      workspaceId ?? "",
      page,
      pageSize,
      billingMode ?? "all",
    ),
    queryFn: async () => {
      const { data, error } = await api
        .workspaces({ workspaceId: workspaceId! })
        .billing.usage.get({
          query: { page, pageSize, ...(billingMode ? { billingMode } : {}) },
        })
      if (error) throw error
      return data
    },
    enabled: !!session && !!workspaceId,
    placeholderData: keepPreviousData,
  })
}

export function useWorkspaceUsageTrend(
  workspaceId: string | null | undefined,
) {
  const { data: session } = authClient.useSession()

  return useQuery({
    queryKey: billingKeys.usageTrend(workspaceId ?? ""),
    queryFn: async () => {
      const { data, error } = await api
        .workspaces({ workspaceId: workspaceId! })
        .billing.usage.trend.get()
      if (error) throw error
      return data
    },
    enabled: !!session && !!workspaceId,
  })
}
