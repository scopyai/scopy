import { Badge } from "@workspace/ui/components/badge"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { formatCredits, formatPeriodEnd } from "@/lib/billing-format"

type Tier = "free" | "premium" | "ultra" | "enterprise"

type Account = {
  tier: Tier
  status: string
  periodEnd: Date | string | null
  cancelAtPeriodEnd: boolean
  monthlyAllowance: number
  creditBalance: number
}

const tierBadgeVariant: Record<
  Tier,
  "outline" | "default" | "secondary"
> = {
  free: "outline",
  premium: "default",
  ultra: "secondary",
  enterprise: "secondary",
}

const tierLabel: Record<Tier, string> = {
  free: "Free",
  premium: "Premium",
  ultra: "Ultra",
  enterprise: "Enterprise",
}

export function AccountSummary({
  account,
  isOwner,
}: {
  account: Account
  isOwner: boolean
}) {
  const isPaid =
    account.tier !== "free" && account.tier !== "enterprise"

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <CardTitle>Current plan</CardTitle>
          <Badge variant={tierBadgeVariant[account.tier]}>
            {tierLabel[account.tier]}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {account.cancelAtPeriodEnd && account.periodEnd && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
            Subscription cancelled — access until{" "}
            <span className="font-medium">
              {formatPeriodEnd(account.periodEnd)}
            </span>
          </div>
        )}

        {isPaid && account.monthlyAllowance > 0 && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">
                Credits remaining
              </span>
              <span className="text-lg font-semibold tabular-nums">
                {formatCredits(account.creditBalance)}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">
                Monthly allowance
              </span>
              <span className="text-lg font-semibold tabular-nums">
                {formatCredits(account.monthlyAllowance)}
              </span>
            </div>
            {!account.cancelAtPeriodEnd && account.periodEnd && (
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground">
                  Next renewal
                </span>
                <span className="text-sm font-medium">
                  {formatPeriodEnd(account.periodEnd)}
                </span>
              </div>
            )}
          </div>
        )}

        {!isOwner && (
          <p className="text-xs text-muted-foreground">
            Billing changes can only be made by the workspace owner.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
