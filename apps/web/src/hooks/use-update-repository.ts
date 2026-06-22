import { useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"

export function useUpdateRepository(workspaceId: string) {
  const queryClient = useQueryClient()
  const queryKey = ["workspaces", workspaceId, "repositories"] as const

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
    onMutate: ({ repositoryId, enabled }) => {
      const previous =
        queryClient.getQueryData<Array<{ id: string; enabled: boolean }>>(
          queryKey
        )
      queryClient.setQueryData<Array<{ id: string; enabled: boolean }>>(
        queryKey,
        (repositories) => {
          if (!repositories) return repositories
          return repositories.map((repository) =>
            repository.id === repositoryId
              ? { ...repository, enabled: enabled ?? repository.enabled }
              : repository
          )
        }
      )
      void queryClient.cancelQueries({ queryKey })
      return { previous }
    },
    onError: (_error, _variables, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData(queryKey, context.previous)
      }
    },
    onSuccess: (updatedRepository) => {
      queryClient.setQueryData<Array<{ id: string; enabled: boolean }>>(
        queryKey,
        (repositories) => {
          if (!repositories) return repositories
          return repositories.map((repository) =>
            repository.id === updatedRepository.id
              ? { ...repository, ...updatedRepository }
              : repository
          )
        }
      )
    },
  })
}
