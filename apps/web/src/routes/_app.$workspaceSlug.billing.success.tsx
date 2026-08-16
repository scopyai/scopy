import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useEffect } from "react"
import { toast } from "sonner"
import { z } from "zod"
import { useQueryClient } from "@tanstack/react-query"
import { Skeleton } from "@workspace/ui/components/skeleton"
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
      toast.success("You're all set")
      navigate({
        to: "/$workspaceSlug/billing",
        params: { workspaceSlug },
        replace: true,
      })
    }

    handleSuccess()
  }, [workspaceId, workspaceSlug, queryClient, setSelectedWorkspaceId, navigate])

  return (
    <div className="px-4 py-6 sm:px-6 sm:py-10">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    </div>
  )
}
