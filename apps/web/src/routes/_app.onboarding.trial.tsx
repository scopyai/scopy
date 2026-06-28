import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { ArrowRightIcon } from "lucide-react"
import { useWorkspaces } from "@/hooks/use-workspaces"
import { useWorkspaceBilling } from "@/hooks/use-workspace-billing"
import { StarterCard } from "@/components/billing/starter-card"
import { PlanCards } from "@/components/billing/plan-cards"
import { getActiveWorkspaces, getWorkspaceSlug } from "@/lib/workspace-slug"

export const Route = createFileRoute("/_app/onboarding/trial")({
  component: OnboardingTrialPage,
})

function OnboardingTrialPage() {
  const navigate = useNavigate()
  const { data: workspaces, isPending: workspacesPending } = useWorkspaces()
  const entry = getActiveWorkspaces(workspaces).at(0)
  const activeWorkspace = entry?.workspace
  const isOwner = entry?.role === "owner"
  const { data: billing, isPending: billingPending } = useWorkspaceBilling(
    activeWorkspace?.id
  )

  if (workspacesPending) return null
  if (!activeWorkspace) return <Navigate to="/onboarding/connect" replace />

  const goToDashboard = () =>
    navigate({
      to: "/$workspaceSlug/repositories",
      params: { workspaceSlug: getWorkspaceSlug(activeWorkspace) },
      replace: true,
    })

  return (
    <div className="flex h-full justify-center px-6 py-10">
      <div className="flex w-full max-w-4xl flex-col gap-8">
        <div className="flex flex-col gap-2 text-center">
          <p className="text-sm font-medium text-muted-foreground">
            Step 4 of 4
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            Start reviewing pull requests
          </h1>
          <p className="mx-auto max-w-xl text-sm text-muted-foreground">
            Deep AI reviews have real model and compute costs, so Scopy is paid.
            Add a card for a one-time{" "}
            <span className="font-medium text-foreground">$1</span> trial —
            about three to five reviews on this workspace. No subscription, no
            other charges until you're ready.
          </p>
        </div>

        {billingPending || !billing ? (
          <Skeleton className="h-32 w-full rounded-xl" />
        ) : (
          <>
            {!billing.starterUsed && (
              <StarterCard
                isOwner={isOwner ?? false}
                workspaceId={activeWorkspace.id}
              />
            )}

            <div className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">
                Or pick a monthly plan if you already know you're in:
              </p>
              <PlanCards
                plans={billing.plans}
                accountTier={billing.account.tier}
                pendingTier={billing.account.pendingTier}
                planChangesDisabled={billing.account.cancelAtPeriodEnd}
                isOwner={isOwner ?? false}
                workspaceId={activeWorkspace.id}
              />
            </div>
          </>
        )}

        <div className="flex justify-center">
          <Button variant="ghost" onClick={goToDashboard}>
            Maybe later — continue on the Free plan
            <ArrowRightIcon data-icon="inline-end" />
          </Button>
        </div>
      </div>
    </div>
  )
}
