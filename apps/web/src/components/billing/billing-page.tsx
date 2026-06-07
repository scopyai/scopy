import { Skeleton } from "@workspace/ui/components/skeleton"
import { useWorkspaceContext } from "@/contexts/workspace-context"
import { useWorkspaces } from "@/hooks/use-workspaces"
import { useWorkspaceBilling } from "@/hooks/use-workspace-billing"
import { AccountSummary } from "./account-summary"
import { PlanCards } from "./plan-cards"
import { CreditHistory } from "./credit-history"

function BillingLoadingSkeleton() {
  return (
    <div className="flex flex-col gap-8">
      <Skeleton className="h-44 w-full rounded-xl" />
      <div className="grid gap-5 lg:grid-cols-3">
        <Skeleton className="h-80 rounded-xl" />
        <Skeleton className="h-80 rounded-xl" />
        <Skeleton className="h-80 rounded-xl" />
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
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-10">
      <AccountSummary
        account={billing.account}
        isOwner={isOwner ?? false}
        workspaceId={selectedWorkspaceId}
      />

      <section className="relative flex flex-col gap-6">
        <div className="pointer-events-none absolute -inset-x-8 -top-8 h-48 bg-[radial-gradient(ellipse_at_top,var(--tw-gradient-stops))] from-primary/8 via-transparent to-transparent" />

        <div className="relative flex flex-col gap-1">
          <h2 className="text-base font-semibold">
            Plans
          </h2>
          <p className="text-sm text-muted-foreground">
            Scale AI code reviews as your team grows
          </p>
        </div>

        <PlanCards
          plans={billing.plans}
          accountTier={billing.account.tier}
          pendingTier={billing.account.pendingTier}
          planChangesDisabled={billing.account.cancelAtPeriodEnd}
          isOwner={isOwner ?? false}
          workspaceId={selectedWorkspaceId}
        />
      </section>

      <CreditHistory workspaceId={selectedWorkspaceId} />
    </div>
  )
}
