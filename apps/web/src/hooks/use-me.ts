import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { authClient } from "@/lib/auth-client"

export function useMeUser() {
  const { data: session } = authClient.useSession()

  return useQuery({
    queryKey: ["me", "user"],
    queryFn: async () => {
      const { data, error } = await api.me.user.get()
      if (error) throw error
      return data
    },
    enabled: !!session,
  })
}
