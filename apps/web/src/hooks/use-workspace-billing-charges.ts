import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { authClient } from "@/lib/auth-client"
import { billingKeys } from "@/lib/billing-query-keys"

export function useWorkspaceBillingCharges(
  workspaceId: string | null | undefined,
  page = 1,
  pageSize = 25,
) {
  const { data: session } = authClient.useSession()

  return useQuery({
    queryKey: billingKeys.charges(workspaceId ?? "", page, pageSize),
    queryFn: async () => {
      const { data, error } = await api
        .workspaces({ workspaceId: workspaceId! })
        .billing.charges.get({ query: { page, pageSize } })
      if (error) throw error
      return data
    },
    enabled: !!session && !!workspaceId,
  })
}
