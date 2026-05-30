import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { authClient } from "@/lib/auth-client"

export function useInstallUrl() {
  const { data: session } = authClient.useSession()

  return useQuery({
    queryKey: ["github", "install-url"],
    queryFn: async () => {
      const { data, error } = await api.github["install-url"].get()
      if (error) throw error
      return data
    },
    enabled: !!session,
    staleTime: 5 * 60 * 1000,
  })
}
