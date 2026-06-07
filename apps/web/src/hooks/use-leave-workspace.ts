import { useMutation, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"

export function useLeaveWorkspace() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (workspaceId: string) => {
      const { data, error } = await api
        .workspaces({ workspaceId })
        .members.me.delete()
      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] })
    },
  })
}
