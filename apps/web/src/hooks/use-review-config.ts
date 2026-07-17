import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { QueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { authClient } from "@/lib/auth-client"

export type ReviewConfigUpdate = {
  reviewDrafts?: boolean
  baseBranchPatterns?: string[]
  pathIncludePatterns?: string[]
  pathExcludePatterns?: string[]
  naturalLanguageRules?: string[]
  maxReviewChangedLines?: number
}

function reviewConfigQueryKey(
  workspaceId: string | null | undefined,
  repositoryId: string | null | undefined
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
  queryKey: readonly unknown[],
  values: ReviewConfigUpdate
) {
  queryClient.setQueryData(queryKey, (current) =>
    current ? { ...current, ...values } : current
  )
}

export function useReviewConfig(
  workspaceId: string | null | undefined,
  repositoryId: string | null | undefined
) {
  const { data: session } = authClient.useSession()

  return useQuery({
    queryKey: reviewConfigQueryKey(workspaceId, repositoryId),
    queryFn: async () => {
      const { data, error } = await api
        .workspaces({ workspaceId: workspaceId! })
        .repositories({ repositoryId: repositoryId! })
        ["review-config"].get()
      if (error) throw error
      return data
    },
    enabled: !!session && !!workspaceId && !!repositoryId,
  })
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
    onSuccess: (data) => queryClient.setQueryData(queryKey, data),
  })
}
