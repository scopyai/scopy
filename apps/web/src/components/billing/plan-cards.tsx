import { useState } from "react"
import { CheckIcon, MailIcon, ZapIcon } from "lucide-react"
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
import { cn } from "@workspace/ui/lib/utils"
import { formatCredits, formatPlanPrice } from "@/lib/billing-format"
import { contactSalesHref } from "@/lib/billing-contact"
import {
  useCheckoutBilling,
  useUpgradeBilling,
} from "@/hooks/use-workspace-billing-mutations"

type Plan = {
  slug: string
  name: string
  billingPeriod: string
  price: number | null
  currency: string | null
  monthlyCredits: number | null
  productId: string | null
  contactSales: boolean
}

type Tier = "free" | "premium" | "ultra" | "enterprise"

function getPlanAction(plan: Plan, accountTier: Tier) {
  if (plan.slug === accountTier) return "current"
  if (plan.contactSales) return "contact"
  if (accountTier === "free" && !plan.contactSales) return "subscribe"
  if (accountTier === "premium" && plan.slug === "ultra") return "upgrade"
  return "none"
}

function PlanCard({
  plan,
  accountTier,
  isOwner,
  workspaceId,
  onUpgradeRequest,
}: {
  plan: Plan
  accountTier: Tier
  isOwner: boolean
  workspaceId: string
  onUpgradeRequest: () => void
}) {
  const action = getPlanAction(plan, accountTier)
  const isCurrent = action === "current"
  const checkout = useCheckoutBilling(workspaceId)

  return (
    <div
      className={cn(
        "flex flex-col gap-4 rounded-xl border p-6 transition-colors",
        isCurrent
          ? "border-primary/40 bg-primary/5"
          : "border-border bg-card",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="font-heading text-base font-semibold">
              {plan.name}
            </span>
            {isCurrent && (
              <Badge variant="default" className="text-xs">
                Current
              </Badge>
            )}
          </div>
          <span className="text-2xl font-bold tabular-nums">
            {formatPlanPrice(plan.price, plan.currency)}
          </span>
        </div>
      </div>

      {plan.monthlyCredits !== null && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ZapIcon className="size-3.5 shrink-0 text-primary" />
          <span>{formatCredits(plan.monthlyCredits)} credits/month</span>
        </div>
      )}

      <div className="mt-auto pt-2">
        {action === "contact" && (
          <Button variant="outline" size="sm" className="w-full" asChild>
            <a href={contactSalesHref}>
              <MailIcon />
              Contact sales
            </a>
          </Button>
        )}

        {action === "current" && (
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <CheckIcon className="size-4 text-primary" />
            Active plan
          </div>
        )}

        {action === "subscribe" && (
          <Button
            size="sm"
            className="w-full"
            disabled={!isOwner || checkout.isPending}
            onClick={() =>
              checkout.mutate(plan.slug as "premium" | "ultra")
            }
          >
            {checkout.isPending ? "Redirecting…" : isOwner ? "Subscribe" : "Owner only"}
          </Button>
        )}

        {action === "upgrade" && (
          <Button
            size="sm"
            className="w-full"
            disabled={!isOwner}
            onClick={onUpgradeRequest}
          >
            {isOwner ? "Upgrade to Ultra" : "Owner only"}
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
  isOwner,
  workspaceId,
}: {
  plans: ReadonlyArray<Plan>
  accountTier: Tier
  isOwner: boolean
  workspaceId: string
}) {
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const upgrade = useUpgradeBilling(workspaceId)

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        {plans.map((plan) => (
          <PlanCard
            key={plan.slug}
            plan={plan}
            accountTier={accountTier}
            isOwner={isOwner}
            workspaceId={workspaceId}
            onUpgradeRequest={() => setUpgradeOpen(true)}
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
              period and your credit balance will be refreshed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={upgrade.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={upgrade.isPending}
              onClick={() =>
                upgrade.mutate(undefined, {
                  onSuccess: () => setUpgradeOpen(false),
                })
              }
            >
              {upgrade.isPending ? "Upgrading…" : "Upgrade to Ultra"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
