import { useState } from "react"
import { CoinsIcon } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"
import { useWorkspaceContext } from "@/contexts/workspace-context"
import { useWorkspaces } from "@/hooks/use-workspaces"
import { useWorkspaceBilling } from "@/hooks/use-workspace-billing"
import { useCheckoutCredits } from "@/hooks/use-workspace-billing-mutations"
import { formatPlanPriceAmount } from "@/lib/billing-format"
import { AccountSummary } from "./account-summary"
import { PlanCards } from "./plan-cards"
import { BillingHistory } from "./billing-history"
import { SubscriptionActions } from "./subscription-actions"

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

const CREDIT_PRESETS = [10, 25, 50, 100]

function CreditTopUp({
  workspaceId,
  unitPriceCents,
  currency,
}: {
  workspaceId: string
  unitPriceCents: number
  currency: string
}) {
  const [credits, setCredits] = useState(10)
  const checkout = useCheckoutCredits(workspaceId)
  const normalizedCredits = Number.isFinite(credits)
    ? Math.max(10, Math.floor(credits))
    : 10
  const totalCents = normalizedCredits * unitPriceCents

  return (
    <section className="relative overflow-hidden rounded-xl border bg-card shadow-sm ring-1 ring-border/50">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/[0.05] via-transparent to-transparent" />

      <div className="relative flex flex-col gap-5 p-6">
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <CoinsIcon className="size-4" />
          </div>
          <div className="flex flex-col gap-0.5">
            <h2 className="text-base font-semibold">Buy additional credits</h2>
            <p className="text-sm text-muted-foreground">
              Top up when you run low —{" "}
              {formatPlanPriceAmount(unitPriceCents, currency)} per credit on
              your current plan.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-4 border-t pt-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-2">
            <span className="text-xs text-muted-foreground">Amount</span>
            <div className="flex flex-wrap items-center gap-2">
              {CREDIT_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setCredits(preset)}
                  className={cn(
                    "rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors",
                    normalizedCredits === preset
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-border/70 hover:text-foreground",
                  )}
                >
                  +{preset}
                </button>
              ))}
              <Input
                type="number"
                min={10}
                step={1}
                value={credits}
                onChange={(event) => setCredits(Number(event.target.value))}
                aria-label="Custom credit amount"
                className="w-24"
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 sm:justify-end">
            <div className="flex flex-col sm:items-end">
              <span className="text-lg font-semibold">
                {formatPlanPriceAmount(totalCents, currency)}
              </span>
              <span className="text-xs text-muted-foreground">
                for {normalizedCredits.toLocaleString("en-US")} credits
              </span>
            </div>
            <Button
              disabled={checkout.isPending || normalizedCredits < 10}
              onClick={() => checkout.mutate(normalizedCredits)}
            >
              {checkout.isPending ? "Redirecting..." : "Buy credits"}
            </Button>
          </div>
        </div>
      </div>
    </section>
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

  const tier = billing?.account.tier
  const isPaid = tier === "premium" || tier === "ultra"
  const activePlan = billing?.plans.find((plan) => plan.slug === tier)

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
      <AccountSummary account={billing.account} isOwner={isOwner ?? false} />

      <section className="relative flex flex-col gap-6 overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 -top-8 h-48 bg-[radial-gradient(ellipse_at_top,var(--tw-gradient-stops))] from-primary/8 via-transparent to-transparent" />

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

      {isOwner &&
        isPaid &&
        activePlan?.topUpCreditUnitPriceCents !== null &&
        activePlan?.topUpCreditUnitPriceCents !== undefined &&
        activePlan.currency && (
          <CreditTopUp
            workspaceId={selectedWorkspaceId}
            unitPriceCents={activePlan.topUpCreditUnitPriceCents}
            currency={activePlan.currency}
          />
        )}

      <BillingHistory workspaceId={selectedWorkspaceId} />

      {isOwner && isPaid && (
        <section className="flex flex-col gap-5">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold">Manage subscription</h2>
            <p className="text-sm text-muted-foreground">
              Update your payment method or cancel your plan
            </p>
          </div>

          <SubscriptionActions
            account={billing.account}
            workspaceId={selectedWorkspaceId}
          />
        </section>
      )}
    </div>
  )
}
