import { useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"

export function useUpdateRepository(workspaceId: string) {
  const queryClient = useQueryClient()
  const queryKey = ["workspaces", workspaceId, "repositories"] as const

  return useMutation({
    mutationFn: async ({
      repositoryId,
      enabled,
      excludedDocLibraries,
    }: {
      repositoryId: string
      enabled?: boolean
      excludedDocLibraries?: string[]
    }) => {
      const { data, error } = await api
        .workspaces({ workspaceId })
        .repositories({ repositoryId })
        .patch({ enabled, excludedDocLibraries })
      if (error) throw error
      return data
    },
    onMutate: ({ repositoryId, enabled, excludedDocLibraries }) => {
      const previous = queryClient.getQueryData<
        Array<{ id: string; enabled: boolean }>
      >(queryKey)
      queryClient.setQueryData<
        Array<{ id: string; enabled: boolean; excludedDocLibraries?: string[] | null }>
      >(queryKey, (repositories) => {
        if (!repositories) return repositories
        return repositories.map((repository) =>
          repository.id === repositoryId
            ? {
                ...repository,
                enabled: enabled ?? repository.enabled,
                excludedDocLibraries:
                  excludedDocLibraries ?? repository.excludedDocLibraries,
              }
            : repository
        )
      })
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
