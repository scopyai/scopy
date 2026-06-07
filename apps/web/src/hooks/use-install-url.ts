import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { authClient } from "@/lib/auth-client"

export function useInstallUrl(source: "connect" | "onboarding" = "connect") {
  const { data: session } = authClient.useSession()

  return useQuery({
    queryKey: ["github", "install-url", source],
    queryFn: async () => {
      const { data, error } = await api.github["install-url"].get({
        query: { source },
      })
      if (error) throw error
      return data
    },
    enabled: !!session,
    staleTime: 5 * 60 * 1000,
  })
}
