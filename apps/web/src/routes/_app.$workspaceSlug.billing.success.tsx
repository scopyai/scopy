import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useEffect } from "react"
import { toast } from "sonner"
import { z } from "zod"
import { useQueryClient } from "@tanstack/react-query"
import { useWorkspaceContext } from "@/contexts/workspace-context"
import { billingKeys } from "@/lib/billing-query-keys"

const searchSchema = z.object({
  workspaceId: z.string(),
})

export const Route = createFileRoute("/_app/$workspaceSlug/billing/success")({
  validateSearch: searchSchema,
  component: BillingSuccessPage,
})

function BillingSuccessPage() {
  const { workspaceSlug } = Route.useParams()
  const { workspaceId } = Route.useSearch()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { setSelectedWorkspaceId } = useWorkspaceContext()

  useEffect(() => {
    async function handleSuccess() {
      setSelectedWorkspaceId(workspaceId)
      queryClient.invalidateQueries({ queryKey: billingKeys.all(workspaceId) })
      await queryClient.refetchQueries({
        queryKey: billingKeys.all(workspaceId),
      })
      toast.success("Subscription activated")
      navigate({
        to: "/$workspaceSlug/billing",
        params: { workspaceSlug },
        replace: true,
      })
    }

    handleSuccess()
  }, [workspaceId, workspaceSlug, queryClient, setSelectedWorkspaceId, navigate])

  return null
}
