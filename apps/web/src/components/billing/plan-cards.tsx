import { useState } from "react"
import { CheckIcon, MailIcon } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Badge } from "@workspace/ui/components/badge"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog"
import { Separator } from "@workspace/ui/components/separator"
import { cn } from "@workspace/ui/lib/utils"
import {
  formatPlanPriceAmount,
  formatUsageBalance,
} from "@/lib/billing-format"
import { contactSalesHref } from "@/lib/billing-contact"
import {
  useCheckoutBilling,
  useChangeBillingPlan,
} from "@/hooks/use-workspace-billing-mutations"

type Plan = {
  slug: string
  name: string
  billingPeriod: string
  price: number | null
  currency: string | null
  monthlyCredits: number | null
  contactSales: boolean
}

type Tier = "free" | "premium" | "ultra" | "enterprise"

const planFeatures: Record<string, string[]> = {
  premium: [
    "AI reviews on every pull request",
    "Unlimited repositories",
    "Team workspace management",
  ],
  ultra: [
    "Everything in Premium",
    "5× monthly usage allowance",
    "Built for high-volume teams",
  ],
  enterprise: [
    "Custom usage & pricing",
    "Dedicated onboarding",
    "Priority support & SLAs",
  ],
}

function getPlanAction(
  plan: Plan,
  accountTier: Tier,
  pendingTier: Tier | null,
  planChangesDisabled: boolean,
) {
  if (plan.slug === accountTier) return "current"
  if (plan.slug === pendingTier) return "pending"
  if (plan.contactSales) return "contact"
  if (planChangesDisabled) return "none"
  if (accountTier === "free" && !plan.contactSales) return "subscribe"
  if (accountTier === "premium" && plan.slug === "ultra") return "upgrade"
  if (accountTier === "ultra" && plan.slug === "premium") return "downgrade"
  return "none"
}

function PlanCard({
  plan,
  accountTier,
  pendingTier,
  planChangesDisabled,
  isOwner,
  workspaceId,
  onUpgradeRequest,
  onDowngradeRequest,
}: {
  plan: Plan
  accountTier: Tier
  pendingTier: Tier | null
  planChangesDisabled: boolean
  isOwner: boolean
  workspaceId: string
  onUpgradeRequest: () => void
  onDowngradeRequest: () => void
}) {
  const action = getPlanAction(
    plan,
    accountTier,
    pendingTier,
    planChangesDisabled,
  )
  const isCurrent = action === "current"
  const isRecommended = plan.slug === "premium"
  const checkout = useCheckoutBilling(workspaceId)
  const features = planFeatures[plan.slug] ?? []

  return (
    <div
      className={cn(
        "relative flex flex-col rounded-xl border bg-card p-6 transition-all",
        isCurrent && "border-primary/50 shadow-md ring-1 ring-primary/30",
        isRecommended &&
          !isCurrent &&
          "border-primary/30 shadow-sm ring-1 ring-primary/15",
        !isCurrent && !isRecommended && "border-border hover:border-border/80",
      )}
    >
      {isRecommended && !isCurrent && (
        <span className="absolute -top-2.5 left-4 rounded-full bg-primary px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary-foreground">
          Recommended
        </span>
      )}

      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-semibold">
            {plan.name}
          </h3>
          {isCurrent && (
            <Badge variant="default" className="text-xs">
              Current
            </Badge>
          )}
        </div>

        <div className="flex items-baseline gap-1">
          <span className="text-xl font-bold">
            {formatPlanPriceAmount(plan.price, plan.currency)}
          </span>
          {plan.price !== null && (
            <span className="text-sm text-muted-foreground">/mo</span>
          )}
        </div>

        {plan.monthlyCredits !== null && (
          <p className="text-sm text-muted-foreground">
            {formatUsageBalance(plan.monthlyCredits)} usage included
          </p>
        )}
      </div>

      <Separator className="my-5" />

      <ul className="flex flex-1 flex-col gap-2.5">
        {features.map((feature) => (
          <li
            key={feature}
            className="flex items-start gap-2 text-sm text-muted-foreground"
          >
            <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-primary" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      <div className="mt-6">
        {action === "contact" && (
          <Button variant="outline" className="w-full" asChild>
            <a href={contactSalesHref}>
              <MailIcon />
              Contact sales
            </a>
          </Button>
        )}

        {action === "current" && (
          <div className="flex h-9 items-center justify-center gap-1.5 text-sm text-muted-foreground">
            <CheckIcon className="size-4 text-primary" />
            Active plan
          </div>
        )}

        {action === "pending" && (
          <div className="flex h-9 items-center justify-center gap-1.5 text-sm text-muted-foreground">
            <CheckIcon className="size-4 text-primary" />
            Scheduled plan
          </div>
        )}

        {action === "subscribe" && (
          <Button
            className="w-full"
            disabled={!isOwner || checkout.isPending}
            onClick={() => checkout.mutate(plan.slug as "premium" | "ultra")}
          >
            {checkout.isPending
              ? "Redirecting…"
              : isOwner
                ? "Get started"
                : "Owner only"}
          </Button>
        )}

        {action === "upgrade" && (
          <Button
            className="w-full"
            disabled={!isOwner}
            onClick={onUpgradeRequest}
          >
            {isOwner ? "Upgrade to Ultra" : "Owner only"}
          </Button>
        )}

        {action === "downgrade" && (
          <Button
            variant="outline"
            className="w-full"
            disabled={!isOwner}
            onClick={onDowngradeRequest}
          >
            {isOwner ? "Downgrade to Premium" : "Owner only"}
          </Button>
        )}

        {action === "none" && <div className="h-9" />}
      </div>
    </div>
  )
}

export function PlanCards({
  plans,
  accountTier,
  pendingTier,
  planChangesDisabled,
  isOwner,
  workspaceId,
}: {
  plans: ReadonlyArray<Plan>
  accountTier: Tier
  pendingTier: Tier | null
  planChangesDisabled: boolean
  isOwner: boolean
  workspaceId: string
}) {
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const [downgradeOpen, setDowngradeOpen] = useState(false)
  const changePlan = useChangeBillingPlan(workspaceId)

  return (
    <>
      <div className="grid gap-5 lg:grid-cols-3">
        {plans.map((plan) => (
          <PlanCard
            key={plan.slug}
            plan={plan}
            accountTier={accountTier}
            pendingTier={pendingTier}
            planChangesDisabled={planChangesDisabled}
            isOwner={isOwner}
            workspaceId={workspaceId}
            onUpgradeRequest={() => setUpgradeOpen(true)}
            onDowngradeRequest={() => setDowngradeOpen(true)}
          />
        ))}
      </div>

      <AlertDialog open={upgradeOpen} onOpenChange={setUpgradeOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Upgrade to Ultra?</AlertDialogTitle>
            <AlertDialogDescription>
              Your subscription will be upgraded to Ultra immediately. Creem
              will charge the prorated amount for the remainder of the billing
              period and your usage balance will be refreshed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={changePlan.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={changePlan.isPending}
              onClick={() =>
                changePlan.mutate("ultra", {
                  onSuccess: () => setUpgradeOpen(false),
                })
              }
            >
              {changePlan.isPending ? "Upgrading…" : "Upgrade to Ultra"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={downgradeOpen} onOpenChange={setDowngradeOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Downgrade to Premium?</AlertDialogTitle>
            <AlertDialogDescription>
              Your Ultra plan and remaining usage balance will stay active until
              the end of the current billing period. Premium pricing and usage
              will apply at the next renewal.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={changePlan.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={changePlan.isPending}
              onClick={() =>
                changePlan.mutate("premium", {
                  onSuccess: () => setDowngradeOpen(false),
                })
              }
            >
              {changePlan.isPending ? "Scheduling…" : "Downgrade to Premium"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
