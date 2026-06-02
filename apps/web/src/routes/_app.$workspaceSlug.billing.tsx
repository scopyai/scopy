import { createFileRoute } from "@tanstack/react-router"
import { CreditCardIcon } from "lucide-react"
import { PageHeader } from "@/components/page-header"
import { BillingPage } from "@/components/billing/billing-page"

export const Route = createFileRoute("/_app/$workspaceSlug/billing")({
  component: BillingRoute,
})

function BillingRoute() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader icon={CreditCardIcon} title="Billing" />

      <div className="flex-1 overflow-auto p-6">
        <BillingPage />
      </div>
    </div>
  )
}
