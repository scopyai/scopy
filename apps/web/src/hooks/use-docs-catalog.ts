import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { authClient } from "@/lib/auth-client"

export function useDocsCatalog() {
  const { data: session } = authClient.useSession()

  return useQuery({
    queryKey: ["docs-catalog"],
    queryFn: async () => {
      const { data, error } = await api.docs.sources.get()
      if (error) throw error
      return data
    },
    enabled: !!session,
    staleTime: 60 * 60 * 1000,
  })
}
