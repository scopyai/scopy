import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { ArrowRightIcon, CheckCircle2Icon } from "lucide-react"
import { useWorkspaces } from "@/hooks/use-workspaces"
import { useWorkspaceBilling } from "@/hooks/use-workspace-billing"
import { PlanCards } from "@/components/billing/plan-cards"
import { formatUsageBalance } from "@/lib/billing-format"
import { getActiveWorkspaces, getWorkspaceSlug } from "@/lib/workspace-slug"

export const Route = createFileRoute("/_app/onboarding/usage")({
  component: OnboardingUsagePage,
})

function OnboardingUsagePage() {
  const navigate = useNavigate()
  const { data: workspaces, isPending: workspacesPending } = useWorkspaces()
  const entry = getActiveWorkspaces(workspaces).at(0)
  const activeWorkspace = entry?.workspace
  const isOwner = entry?.role === "owner"
  const {
    data: billing,
    isError: billingError,
    isPending: billingPending,
    refetch: refetchBilling,
  } = useWorkspaceBilling(activeWorkspace?.id)

  if (workspacesPending) return null
  if (!activeWorkspace) return <Navigate to="/onboarding/connect" replace />

  const goToDashboard = () =>
    navigate({
      to: "/$workspaceSlug/repositories",
      params: { workspaceSlug: getWorkspaceSlug(activeWorkspace) },
      replace: true,
    })

  const includedUsage = billing?.account.creditBalance ?? 1_000_000

  return (
    <div className="flex h-full justify-center px-6 py-10">
      <div className="flex w-full max-w-4xl flex-col gap-8">
        <div className="flex flex-col gap-2 text-center">
          <p className="text-sm font-medium text-muted-foreground">
            Step 4 of 4
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            You're ready to review
          </h1>
          <p className="mx-auto max-w-xl text-sm text-muted-foreground">
            We added{" "}
            <span className="font-medium text-foreground">
              {formatUsageBalance(includedUsage)}
            </span>{" "}
            of one-time included usage to this workspace. Use it now without a
            card, or choose a paid plan for ongoing reviews.
          </p>
        </div>

        <div className="rounded-xl border bg-card p-6 shadow-sm ring-1 ring-border/50">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <CheckCircle2Icon className="size-5" />
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <h2 className="text-base font-semibold">
                  Included usage is active
                </h2>
                <p className="text-sm text-muted-foreground">
                  This is a one-time signup credit. Reviews debit this balance
                  based on actual model and compute usage.
                </p>
              </div>
            </div>
            <Button className="shrink-0" onClick={goToDashboard}>
              Use included usage
              <ArrowRightIcon data-icon="inline-end" />
            </Button>
          </div>
        </div>

        {billingPending ? (
          <Skeleton className="h-80 w-full rounded-xl" />
        ) : billingError || !billing ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-destructive/30 bg-card p-6 text-center">
            <p className="text-sm text-muted-foreground">
              Plan details could not be loaded.
            </p>
            <Button variant="outline" onClick={() => refetchBilling()}>
              Retry
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h2 className="text-base font-semibold">Keep reviews running</h2>
              <p className="text-sm text-muted-foreground">
                Pick a monthly plan now if you want review usage beyond the
                one-time included balance.
              </p>
            </div>
            <PlanCards
              plans={billing.plans}
              accountTier={billing.account.tier}
              pendingTier={billing.account.pendingTier}
              planChangesDisabled={billing.account.cancelAtPeriodEnd}
              isOwner={isOwner ?? false}
              workspaceId={activeWorkspace.id}
            />
          </div>
        )}
      </div>
    </div>
  )
}
