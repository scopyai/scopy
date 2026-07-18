import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { ArrowRightIcon } from "lucide-react"
import { useWorkspaces } from "@/hooks/use-workspaces"
import { useWorkspaceBilling } from "@/hooks/use-workspace-billing"
import { PlanCards } from "@/components/billing/plan-cards"
import { formatReviewCredits } from "@/lib/billing-format"
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

  const includedCredits = billing?.account.creditBalance ?? 0

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
            This workspace has{" "}
            <span className="font-medium text-foreground">
              {formatReviewCredits(includedCredits)}
            </span>{" "}
            available. Choose a paid plan to run managed reviews.
          </p>
        </div>

        {billingPending ? (
          <Skeleton className="h-80 w-full rounded-xl" />
        ) : billingError ? (
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
                Pick a monthly plan to get a monthly review credit allowance.
              </p>
            </div>
            <PlanCards
              plans={billing.plans}
              accountTier={billing.account.tier}
              pendingTier={billing.account.pendingTier}
              planChangesDisabled={billing.account.cancelAtPeriodEnd}
              isOwner={isOwner}
              workspaceId={activeWorkspace.id}
            />

            <div className="flex justify-center pt-2">
              <button
                type="button"
                onClick={goToDashboard}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                Continue to dashboard
                <ArrowRightIcon className="size-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
