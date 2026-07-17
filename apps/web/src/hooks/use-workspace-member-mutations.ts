import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { api } from "@/lib/api"
import { memberKeys } from "@/lib/member-query-keys"

export function useInviteWorkspaceMember(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      email,
      role,
    }: {
      email: string
      role: "admin" | "member"
    }) => {
      const { data, error } = await api
        .workspaces({ workspaceId })
        .members.post({ email, role })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: memberKeys.all(workspaceId) })
    },
    onError: (err: { value?: { error?: string }; status?: number }) => {
      const message = err.value?.error
      if (message === "User not found") {
        toast.error("No account found with that email address")
      } else if (message === "User is already a workspace member") {
        toast.error("This user is already a member of this workspace")
      } else {
        toast.error("Failed to send invitation")
      }
    },
  })
}

export function useUpdateWorkspaceMember(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      memberId,
      role,
    }: {
      memberId: string
      role: "admin" | "member"
    }) => {
      const { data, error } = await api
        .workspaces({ workspaceId })
        .members({ memberId })
        .patch({ role })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: memberKeys.all(workspaceId) })
    },
    onError: (err: { value?: { error?: string } }) => {
      const message = err.value?.error
      toast.error(message ?? "Failed to update member role")
    },
  })
}

export function useRemoveWorkspaceMember(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (memberId: string) => {
      const { data, error } = await api
        .workspaces({ workspaceId })
        .members({ memberId })
        .delete()
      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: memberKeys.all(workspaceId) })
    },
    onError: (err: { value?: { error?: string } }) => {
      const message = err.value?.error
      toast.error(message ?? "Failed to remove member")
    },
  })
}

export function useAcceptWorkspaceInvitation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (workspaceId: string) => {
      const { data, error } = await api
        .workspaces({ workspaceId })
        .members.accept.post()
      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] })
    },
    onError: () => {
      toast.error("Failed to accept invitation")
    },
  })
}

export function useRejectWorkspaceInvitation() {
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
    onError: () => {
      toast.error("Failed to reject invitation")
    },
  })
}
