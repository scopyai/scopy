import { createFileRoute } from "@tanstack/react-router"
import { CreditCardIcon } from "lucide-react"
import { useWorkspaceContext } from "@/contexts/workspace-context"
import { useWorkspaces } from "@/hooks/use-workspaces"
import { BillingPage } from "@/components/billing/billing-page"

export const Route = createFileRoute("/_app/billing")({
  component: BillingRoute,
})

function BillingRoute() {
  const { selectedWorkspaceId } = useWorkspaceContext()
  const { data: workspaces } = useWorkspaces()

  const selectedEntry = workspaces?.find(
    (w) => w.workspace.id === selectedWorkspaceId,
  )

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex h-14 shrink-0 items-center border-b border-border px-4 gap-2">
        <CreditCardIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="text-sm font-medium">Billing</span>
        {selectedEntry && (
          <>
            <span className="text-muted-foreground">/</span>
            <span className="truncate text-sm text-muted-foreground">
              {selectedEntry.workspace.name}
            </span>
          </>
        )}
      </div>

      <div className="flex-1 overflow-auto p-6">
        <BillingPage />
      </div>
    </div>
  )
}
