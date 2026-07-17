import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { api } from "@/lib/api"
import { authClient } from "@/lib/auth-client"

const docSourceKeys = {
  all: (workspaceId: string) => ["workspaces", workspaceId, "doc-sources"],
}

export function useWorkspaceDocSources(workspaceId: string | null | undefined) {
  const { data: session } = authClient.useSession()

  return useQuery({
    queryKey: docSourceKeys.all(workspaceId ?? ""),
    queryFn: async () => {
      const { data, error } = await api
        .workspaces({ workspaceId: workspaceId! })
        .docs.sources.get()
      if (error) throw error
      return data
    },
    enabled: !!session && !!workspaceId,
    refetchInterval: (query) => {
      const sources = query.state.data
      const active = sources?.some(
        (source) =>
          source.status === "crawling" ||
          (source.status === "idle" && source.activePageCount === 0)
      )
      return active ? 3000 : false
    },
  })
}

export function useCreateWorkspaceDocSource(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      name,
      llmsTxtUrl,
    }: {
      name: string
      llmsTxtUrl: string
    }) => {
      const { data, error } = await api
        .workspaces({ workspaceId })
        .docs.sources.post({ name, llmsTxtUrl })
      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: docSourceKeys.all(workspaceId),
      })
      toast.success("Documentation source added – crawling started")
    },
    onError: (err: { value?: { error?: string } }) => {
      toast.error(err.value?.error ?? "Failed to add documentation source")
    },
  })
}

export function useDeleteWorkspaceDocSource(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (sourceId: string) => {
      const { data, error } = await api
        .workspaces({ workspaceId })
        .docs.sources({ sourceId })
        .delete()
      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: docSourceKeys.all(workspaceId),
      })
    },
    onError: (err: { value?: { error?: string } }) => {
      toast.error(err.value?.error ?? "Failed to remove documentation source")
    },
  })
}

export function useCrawlWorkspaceDocSource(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (sourceId: string) => {
      const { data, error } = await api
        .workspaces({ workspaceId })
        .docs.sources({ sourceId })
        .crawl.post()
      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: docSourceKeys.all(workspaceId),
      })
      toast.success("Recrawl started")
    },
    onError: (err: { value?: { error?: string } }) => {
      toast.error(err.value?.error ?? "Failed to start recrawl")
    },
  })
}
