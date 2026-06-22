import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"

export type WorkspaceReviewConfigUpdate = {
  reviewDrafts?: boolean
  baseBranchPatterns?: string[]
  pathIncludePatterns?: string[]
  pathExcludePatterns?: string[]
  maxReviewChangedLines?: number
}

export function workspaceReviewConfigQueryKey(workspaceId: string) {
  return ["workspaces", workspaceId, "review-config"] as const
}

export function applyWorkspaceReviewConfigOptimisticUpdate(
  queryClient: QueryClient,
  queryKey: ReturnType<typeof workspaceReviewConfigQueryKey>,
  values: WorkspaceReviewConfigUpdate
) {
  queryClient.setQueryData(queryKey, (current) =>
    current ? { ...current, ...values } : current
  )
}

export function useUpdateWorkspaceReviewConfig(workspaceId: string) {
  const queryClient = useQueryClient()
  const queryKey = workspaceReviewConfigQueryKey(workspaceId)

  return useMutation({
    mutationFn: async (values: WorkspaceReviewConfigUpdate) => {
      const { data, error } = await api
        .workspaces({ workspaceId })
        ["review-config"].patch(values)
      if (error) throw error
      return data
    },
    onMutate: (values) => {
      const previous = queryClient.getQueryData(queryKey)
      applyWorkspaceReviewConfigOptimisticUpdate(queryClient, queryKey, values)
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
