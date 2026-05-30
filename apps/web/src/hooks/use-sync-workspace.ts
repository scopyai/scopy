import { useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"

export function useSyncWorkspace(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      const { data, error } = await api.workspaces({ workspaceId }).sync.post()
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
