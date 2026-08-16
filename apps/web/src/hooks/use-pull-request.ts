import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { authClient } from "@/lib/auth-client"

export function usePullRequest(
  workspaceId: string | null | undefined,
  repositoryId: string | null | undefined,
  pullRequestId: string | null | undefined,
  prioritizeSync = false,
) {
  const { data: session } = authClient.useSession()

  return useQuery({
    queryKey: [
      "workspaces",
      workspaceId,
      "repositories",
      repositoryId,
      "pull-requests",
      pullRequestId,
      prioritizeSync,
    ],
    queryFn: async () => {
      if (prioritizeSync) {
        await api
          .workspaces({ workspaceId: workspaceId! })
          .repositories({ repositoryId: repositoryId! })
          ["pull-requests"]({ pullRequestId: pullRequestId! })
          .sync.post()
      }

      const { data, error } = await api
        .workspaces({ workspaceId: workspaceId! })
        .repositories({ repositoryId: repositoryId! })
        ["pull-requests"]({ pullRequestId: pullRequestId! })
        .get()
      if (error) throw error
      return data
    },
    enabled: !!session && !!workspaceId && !!repositoryId && !!pullRequestId,
  })
}
