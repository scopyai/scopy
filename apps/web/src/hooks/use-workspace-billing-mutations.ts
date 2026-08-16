import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { api } from "@/lib/api"
import { billingKeys } from "@/lib/billing-query-keys"
import { useRedirectLock } from "@/hooks/use-redirect-lock"

function useBillingRedirect<T>(
  request: (variables: T) => Promise<string>,
  errorMessage: string
) {
  const { isRedirecting, startRedirect, cancelRedirect, redirectTo } =
    useRedirectLock()
  const mutation = useMutation({
    mutationFn: request,
    onMutate: startRedirect,
    onSuccess: redirectTo,
    onError: () => {
      cancelRedirect()
      toast.error(errorMessage)
    },
  })
  return { ...mutation, isRedirecting }
}

export function useCheckoutBilling(workspaceId: string) {
  return useBillingRedirect(async (tier: "premium" | "ultra") => {
    const { data, error } = await api
      .workspaces({ workspaceId })
      .billing.checkout.post({ tier, requestId: crypto.randomUUID() })
    if (error) throw error
    if (!data.url) throw new Error("Missing checkout URL")
    return data.url
  }, "Failed to start checkout")
}

export function useCheckoutCredits(workspaceId: string) {
  return useBillingRedirect(async (credits: number) => {
    const { data, error } = await api
      .workspaces({ workspaceId })
      .billing.credits.checkout.post({
        credits,
        requestId: crypto.randomUUID(),
      })
    if (error) throw error
    if (!data.url) throw new Error("Missing checkout URL")
    return data.url
  }, "Failed to start credit checkout")
}

export function usePortalBilling(workspaceId: string) {
  return useBillingRedirect<void>(async () => {
    const { data, error } = await api
      .workspaces({ workspaceId })
      .billing.portal.post()
    if (error) throw error
    if (!data.url) throw new Error("Missing portal URL")
    return data.url
  }, "Failed to open billing portal")
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
      toast.success(data.message)
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
