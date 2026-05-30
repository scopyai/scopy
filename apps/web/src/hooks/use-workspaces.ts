import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { authClient } from "@/lib/auth-client"

export function useWorkspaces() {
  const { data: session } = authClient.useSession()

  return useQuery({
    queryKey: ["workspaces"],
    queryFn: async () => {
      const { data, error } = await api.workspaces.get()
      if (error) throw error
      return data
    },
    enabled: !!session,
  })
}
