import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { authClient } from "@/lib/auth-client"

export function useRepositories(workspaceId: string | null | undefined) {
  const { data: session } = authClient.useSession()

  return useQuery({
    queryKey: ["workspaces", workspaceId, "repositories"],
    queryFn: async () => {
      const { data, error } = await api.workspaces({ workspaceId: workspaceId! }).repositories.get()
      if (error) throw error
      return data
    },
    enabled: !!session && !!workspaceId,
  })
}
