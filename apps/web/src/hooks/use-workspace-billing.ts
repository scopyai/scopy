import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { authClient } from "@/lib/auth-client"
import { billingKeys } from "@/lib/billing-query-keys"

export function useWorkspaceBilling(workspaceId: string | null | undefined) {
  const { data: session } = authClient.useSession()

  return useQuery({
    queryKey: billingKeys.all(workspaceId ?? ""),
    queryFn: async () => {
      const { data, error } = await api
        .workspaces({ workspaceId: workspaceId! })
        .billing.get()
      if (error) throw error
      return data
    },
    enabled: !!session && !!workspaceId,
  })
}
