import { Skeleton } from "@workspace/ui/components/skeleton"
import { useWorkspaceContext } from "@/contexts/workspace-context"
import { useWorkspaces } from "@/hooks/use-workspaces"
import { useWorkspaceBilling } from "@/hooks/use-workspace-billing"
import { AccountSummary } from "./account-summary"
import { PlanCards } from "./plan-cards"
import { SubscriptionActions } from "./subscription-actions"
import { CreditLedger } from "./credit-ledger"

function BillingLoadingSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-36 w-full rounded-xl" />
      <div className="grid gap-4 sm:grid-cols-3">
        <Skeleton className="h-44 rounded-xl" />
        <Skeleton className="h-44 rounded-xl" />
        <Skeleton className="h-44 rounded-xl" />
      </div>
      <Skeleton className="h-48 w-full rounded-xl" />
    </div>
  )
}

export function BillingPage() {
  const { selectedWorkspaceId } = useWorkspaceContext()
  const { data: workspaces } = useWorkspaces()
  const {
    data: billing,
    isPending,
    isError,
    refetch,
  } = useWorkspaceBilling(selectedWorkspaceId)

  const selectedEntry = workspaces?.find(
    (w) => w.workspace.id === selectedWorkspaceId,
  )
  const isOwner = selectedEntry?.role === "owner"

  if (!selectedWorkspaceId) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">
          Select an organization to view billing
        </p>
      </div>
    )
  }

  if (isPending) {
    return <BillingLoadingSkeleton />
  }

  if (isError || !billing) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <p className="text-sm text-muted-foreground">
          Failed to load billing information
        </p>
        <button
          className="text-sm text-primary underline-offset-4 hover:underline"
          onClick={() => refetch()}
        >
          Try again
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <AccountSummary account={billing.account} isOwner={isOwner ?? false} />

      {isOwner && (
        <SubscriptionActions
          account={billing.account}
          workspaceId={selectedWorkspaceId}
        />
      )}

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">Plans</h2>
        <PlanCards
          plans={billing.plans}
          accountTier={billing.account.tier}
          pendingTier={billing.account.pendingTier}
          planChangesDisabled={billing.account.cancelAtPeriodEnd}
          isOwner={isOwner ?? false}
          workspaceId={selectedWorkspaceId}
        />
      </div>

      <CreditLedger workspaceId={selectedWorkspaceId} />
    </div>
  )
}
