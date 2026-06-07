import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { memberKeys } from "@/lib/member-query-keys"

export function useWorkspaceMembers(workspaceId: string | null) {
  return useQuery({
    queryKey: memberKeys.all(workspaceId ?? ""),
    queryFn: async () => {
      const { data, error } = await api
        .workspaces({ workspaceId: workspaceId! })
        .members.get()
      if (error) throw error
      return data
    },
    enabled: !!workspaceId,
  })
}
