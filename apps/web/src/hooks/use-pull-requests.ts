import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { authClient } from "@/lib/auth-client"

export function usePullRequests(
  workspaceId: string | null | undefined,
  repositoryId: string | null | undefined,
) {
  const { data: session } = authClient.useSession()

  return useQuery({
    queryKey: ["workspaces", workspaceId, "repositories", repositoryId, "pull-requests"],
    queryFn: async () => {
      const { data, error } = await api
        .workspaces({ workspaceId: workspaceId! })
        .repositories({ repositoryId: repositoryId! })
        ["pull-requests"].get()
      if (error) throw error
      return data
    },
    enabled: !!session && !!workspaceId && !!repositoryId,
  })
}
