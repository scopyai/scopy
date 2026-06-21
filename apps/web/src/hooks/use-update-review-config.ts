import { useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"

export type ReviewConfigUpdate = {
  enabled?: boolean
  reviewPullRequests?: boolean
  reviewDrafts?: boolean
  baseBranchPatterns?: string[]
  pathIncludePatterns?: string[]
  pathExcludePatterns?: string[]
}

export function useUpdateReviewConfig(
  workspaceId: string,
  repositoryId: string,
) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (values: ReviewConfigUpdate) => {
      const { data, error } = await api
        .workspaces({ workspaceId })
        .repositories({ repositoryId })
        ["review-config"].patch(values)
      if (error) throw error
      return data
    },
    onSuccess: (data) => {
      queryClient.setQueryData(
        [
          "workspaces",
          workspaceId,
          "repositories",
          repositoryId,
          "review-config",
        ],
        data,
      )
    },
  })
}
