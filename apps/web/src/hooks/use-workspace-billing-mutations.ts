import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { api } from "@/lib/api"
import { billingKeys } from "@/lib/billing-query-keys"

export function useCheckoutBilling(workspaceId: string) {
  return useMutation({
    mutationFn: async (tier: "premium" | "ultra") => {
      const { data, error } = await api
        .workspaces({ workspaceId })
        .billing.checkout.post({ tier, requestId: crypto.randomUUID() })
      if (error) throw error
      return data
    },
    onSuccess: (data) => {
      if (data?.url) {
        window.location.href = data.url
      }
    },
    onError: () => {
      toast.error("Failed to start checkout")
    },
  })
}

export function useStarterCheckout(workspaceId: string) {
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await api
        .workspaces({ workspaceId })
        .billing.starter.post({ requestId: crypto.randomUUID() })
      if (error) throw error
      return data
    },
    onSuccess: (data) => {
      if (data?.url) {
        window.location.href = data.url
      }
    },
    onError: () => {
      toast.error("Failed to start checkout")
    },
  })
}

export function usePortalBilling(workspaceId: string) {
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await api
        .workspaces({ workspaceId })
        .billing.portal.post()
      if (error) throw error
      return data
    },
    onSuccess: (data) => {
      if (data?.url) {
        window.location.href = data.url
      }
    },
    onError: () => {
      toast.error("Failed to open billing portal")
    },
  })
}

export function useCancelBilling(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      const { data, error } = await api
        .workspaces({ workspaceId })
        .billing.cancel.post()
      if (error) throw error
      return data
    },
    onSuccess: async (data) => {
      toast.success(data?.message ?? "Subscription cancellation scheduled")
      await queryClient.refetchQueries({
        queryKey: billingKeys.all(workspaceId),
      })
    },
    onError: () => {
      toast.error("Failed to cancel subscription")
    },
  })
}

export function useChangeBillingPlan(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (tier: "premium" | "ultra") => {
      const { data, error } = await api
        .workspaces({ workspaceId })
        .billing["change-plan"].post({ tier })
      if (error) throw error
      return data
    },
    onSuccess: (data) => {
      queryClient.setQueryData(billingKeys.all(workspaceId), data)
      toast.success("Billing plan updated")
    },
    onError: () => {
      toast.error("Failed to update billing plan")
    },
  })
}
