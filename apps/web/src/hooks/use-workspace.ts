import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { authClient } from "@/lib/auth-client"

export function useWorkspace(workspaceId: string | null | undefined) {
  const { data: session } = authClient.useSession()

  return useQuery({
    queryKey: ["workspaces", workspaceId],
    queryFn: async () => {
      const { data, error } = await api.workspaces({ workspaceId: workspaceId! }).get()
      if (error) throw error
      return data
    },
    enabled: !!session && !!workspaceId,
  })
}
