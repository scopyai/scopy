import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"

export type ReviewConfigUpdate = {
  reviewDrafts?: boolean
  baseBranchPatterns?: string[]
  pathIncludePatterns?: string[]
  pathExcludePatterns?: string[]
  naturalLanguageRules?: string[]
  maxReviewChangedLines?: number
}

export function reviewConfigQueryKey(
  workspaceId: string,
  repositoryId: string
) {
  return [
    "workspaces",
    workspaceId,
    "repositories",
    repositoryId,
    "review-config",
  ] as const
}

export function applyReviewConfigOptimisticUpdate(
  queryClient: QueryClient,
  queryKey: ReturnType<typeof reviewConfigQueryKey>,
  values: ReviewConfigUpdate
) {
  queryClient.setQueryData(queryKey, (current) =>
    current ? { ...current, ...values } : current
  )
}

export function useUpdateReviewConfig(
  workspaceId: string,
  repositoryId: string
) {
  const queryClient = useQueryClient()
  const queryKey = reviewConfigQueryKey(workspaceId, repositoryId)

  return useMutation({
    mutationFn: async (values: ReviewConfigUpdate) => {
      const { data, error } = await api
        .workspaces({ workspaceId })
        .repositories({ repositoryId })
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
    },
  })
}
