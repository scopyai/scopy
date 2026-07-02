import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { authClient } from "@/lib/auth-client"

export type ProviderKeyProvider = "openrouter" | "gateway"
export type ReviewBillingMode = "platform" | "byok"

export function providerKeysQueryKey(workspaceId: string) {
  return ["workspaces", workspaceId, "provider-keys"] as const
}

export function useProviderKeys(workspaceId: string | null | undefined) {
  const { data: session } = authClient.useSession()

  return useQuery({
    queryKey: providerKeysQueryKey(workspaceId ?? ""),
    queryFn: async () => {
      const { data, error } = await api
        .workspaces({ workspaceId: workspaceId! })
        ["provider-keys"].get()
      if (error) throw error
      return data
    },
    enabled: !!session && !!workspaceId,
  })
}

export function useSetProviderKey(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      provider,
      apiKey,
    }: {
      provider: ProviderKeyProvider
      apiKey: string
    }) => {
      const { data, error } = await api
        .workspaces({ workspaceId })
        ["provider-keys"]({ provider })
        .put({ apiKey })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: providerKeysQueryKey(workspaceId),
      })
    },
  })
}

export function useDeleteProviderKey(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ provider }: { provider: ProviderKeyProvider }) => {
      const { data, error } = await api
        .workspaces({ workspaceId })
        ["provider-keys"]({ provider })
        .delete()
      if (error) throw error
      return data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: providerKeysQueryKey(workspaceId),
      })
    },
  })
}

export function useSetWorkspaceBillingMode(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ billingMode }: { billingMode: ReviewBillingMode }) => {
      const { data, error } = await api
        .workspaces({ workspaceId })
        ["billing-mode"].patch({ billingMode })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: providerKeysQueryKey(workspaceId),
      })
    },
  })
}

export function useSetWorkspaceByokProvider(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      provider,
    }: {
      provider: ProviderKeyProvider | null
    }) => {
      const { data, error } = await api
        .workspaces({ workspaceId })
        ["byok-provider"].patch({ provider })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: providerKeysQueryKey(workspaceId),
      })
    },
  })
}

export function useSetRepositoryByokProvider(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      repositoryId,
      provider,
    }: {
      repositoryId: string
      provider: ProviderKeyProvider | null
    }) => {
      const { data, error } = await api
        .workspaces({ workspaceId })
        .repositories({ repositoryId })
        ["byok-provider"].patch({ provider })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["workspaces", workspaceId, "repositories"],
      })
    },
  })
}

export function useSetRepositoryBillingMode(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      repositoryId,
      billingMode,
    }: {
      repositoryId: string
      billingMode: ReviewBillingMode | null
    }) => {
      const { data, error } = await api
        .workspaces({ workspaceId })
        .repositories({ repositoryId })
        ["billing-mode"].patch({ billingMode })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["workspaces", workspaceId, "repositories"],
      })
    },
  })
}
