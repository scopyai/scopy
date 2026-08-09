import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"

const memoriesKey = (workspaceId: string, repositoryId?: string) =>
  ["workspaces", workspaceId, "memories", repositoryId ?? "all"] as const

export function useWorkspaceMemories(
  workspaceId: string | null,
  repositoryId?: string
) {
  return useQuery({
    queryKey: memoriesKey(workspaceId ?? "", repositoryId),
    queryFn: async () => {
      const { data, error } = await api
        .workspaces({ workspaceId: workspaceId! })
        .memories.get({ query: { repositoryId } })
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
      queryClient.invalidateQueries({
        queryKey: ["workspaces", workspaceId, "memories"],
      }),
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
      queryClient.invalidateQueries({
        queryKey: ["workspaces", workspaceId, "memories"],
      }),
  })
}
