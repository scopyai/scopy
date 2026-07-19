import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"

const memoriesKey = (workspaceId: string) =>
  ["workspaces", workspaceId, "memories"] as const

export function useWorkspaceMemories(workspaceId: string | null) {
  return useQuery({
    queryKey: memoriesKey(workspaceId ?? ""),
    queryFn: async () => {
      const { data, error } = await api
        .workspaces({ workspaceId: workspaceId! })
        .memories.get()
      if (error) throw error
      return data
    },
    enabled: !!workspaceId,
  })
}

export type WorkspaceMemory = NonNullable<
  ReturnType<typeof useWorkspaceMemories>["data"]
>[number]

export function useUpdateMemory(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      memoryId,
      content,
      enabled,
    }: {
      memoryId: string
      content?: string
      enabled?: boolean
    }) => {
      const { data, error } = await api
        .workspaces({ workspaceId })
        .memories({ memoryId })
        .patch({ content, enabled })
      if (error) throw error
      return data
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: memoriesKey(workspaceId) }),
  })
}

export function useDeleteMemory(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (memoryId: string) => {
      const { data, error } = await api
        .workspaces({ workspaceId })
        .memories({ memoryId })
        .delete()
      if (error) throw error
      return data
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: memoriesKey(workspaceId) }),
  })
}
