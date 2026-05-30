import { useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"

export function useUpdateRepository(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      repositoryId,
      enabled,
    }: {
      repositoryId: string
      enabled?: boolean
    }) => {
      const { data, error } = await api
        .workspaces({ workspaceId })
        .repositories({ repositoryId })
        .patch({ enabled })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["workspaces", workspaceId, "repositories"],
      })
    },
  })
}
