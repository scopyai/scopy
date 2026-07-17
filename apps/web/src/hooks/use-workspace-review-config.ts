import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { authClient } from "@/lib/auth-client"
import { applyReviewConfigOptimisticUpdate } from "@/hooks/use-review-config"
import type { ReviewConfigUpdate } from "@/hooks/use-review-config"

function workspaceReviewConfigQueryKey(workspaceId: string | null | undefined) {
  return ["workspaces", workspaceId, "review-config"] as const
}

export function useWorkspaceReviewConfig(
  workspaceId: string | null | undefined
) {
  const { data: session } = authClient.useSession()

  return useQuery({
    queryKey: workspaceReviewConfigQueryKey(workspaceId),
    queryFn: async () => {
      const { data, error } = await api
        .workspaces({ workspaceId: workspaceId! })
        ["review-config"].get()
      if (error) throw error
      return data
    },
    enabled: !!session && !!workspaceId,
  })
}

export function useUpdateWorkspaceReviewConfig(workspaceId: string) {
  const queryClient = useQueryClient()
  const queryKey = workspaceReviewConfigQueryKey(workspaceId)

  return useMutation({
    mutationFn: async (values: ReviewConfigUpdate) => {
      const { data, error } = await api
        .workspaces({ workspaceId })
        ["review-config"].patch(values)
      if (error) throw error
      return data
    },
    onMutate: (values) => {
      const previous = queryClient.getQueryData(queryKey)
      applyReviewConfigOptimisticUpdate(queryClient, queryKey, values)
      void queryClient.cancelQueries({ queryKey })
      return { previous }
    },
    onError: (_error, _values, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(queryKey, context.previous)
      }
    },
    onSuccess: (data) => {
      queryClient.setQueryData(queryKey, data)
      void queryClient.invalidateQueries({
        queryKey: ["workspaces", workspaceId, "repositories"],
        exact: true,
      })
      void queryClient.invalidateQueries({
        queryKey: ["workspaces", workspaceId, "repositories"],
        predicate: (query) => query.queryKey[4] === "review-config",
      })
    },
  })
}
