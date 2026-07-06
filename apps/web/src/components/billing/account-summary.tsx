import { cn } from "@workspace/ui/lib/utils"
import { formatPeriodEnd, formatReviewCredits } from "@/lib/billing-format"

type Tier = "free" | "premium" | "ultra" | "enterprise"

type Account = {
  tier: Tier
  status: string
  periodEnd: Date | string | null
  cancelAtPeriodEnd: boolean
  pendingTier: Tier | null
  pendingChangeAt: Date | string | null
  monthlyAllowance: number
  creditBalance: number
  includedCreditBalance: number
  purchasedCreditBalance: number
  creemCustomerId: string | null
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
  const hasFreeCredit = account.tier === "free" && account.creditBalance > 0
  const usagePercent =
    account.monthlyAllowance > 0
      ? Math.min(
          100,
          Math.max(0, (account.creditBalance / account.monthlyAllowance) * 100),
        )
      : 0

  return (
    <div className="relative overflow-hidden rounded-xl border bg-card shadow-sm ring-1 ring-border/50">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/[0.05] via-transparent to-transparent" />

      <div className="relative flex flex-col gap-5 p-6">
        <p className="text-sm text-muted-foreground">
          You're on the{" "}
          <span className="font-medium text-foreground">
            {tierLabel[account.tier]}
          </span>{" "}
          plan
        </p>

        {account.cancelAtPeriodEnd && account.periodEnd && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
            Subscription cancelled — access until{" "}
            <span className="font-medium">
              {formatPeriodEnd(account.periodEnd)}
            </span>
          </div>
        )}

        {!account.cancelAtPeriodEnd &&
          account.pendingTier &&
          account.pendingChangeAt && (
            <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-sm text-blue-700 dark:text-blue-400">
              Downgrade to {tierLabel[account.pendingTier]} scheduled for{" "}
              <span className="font-medium">
                {formatPeriodEnd(account.pendingChangeAt)}
              </span>
            </div>
          )}

        {isPaid && account.monthlyAllowance > 0 && (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <Stat
                label="Credits remaining"
                value={formatReviewCredits(account.creditBalance)}
                large
              />
              <Stat
                label="Monthly allowance"
                value={formatReviewCredits(account.monthlyAllowance)}
                large
              />
              {!account.cancelAtPeriodEnd && account.periodEnd && (
                <Stat
                  label="Next renewal"
                  value={formatPeriodEnd(account.periodEnd)}
                />
              )}
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Billing period credits</span>
                <span>{Math.round(usagePercent)}% remaining</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    "h-full rounded-full bg-primary transition-all duration-500",
                  )}
                  style={{ width: `${usagePercent}%` }}
                />
              </div>
            </div>
          </>
        )}

        {hasFreeCredit && (
          <Stat
            label="Included credits remaining"
            value={formatReviewCredits(account.creditBalance)}
            large
          />
        )}

        {account.tier === "free" && account.creditBalance <= 0 && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
            Choose a plan below to start managed pull request reviews.
          </div>
        )}

        {isPaid && (
          <div className="grid gap-3 border-t pt-4 text-sm sm:grid-cols-2">
            <Stat
              label="Monthly credits"
              value={formatReviewCredits(account.includedCreditBalance)}
            />
            <Stat
              label="Purchased credits"
              value={formatReviewCredits(account.purchasedCreditBalance)}
            />
          </div>
        )}

        {!isOwner && (
          <p className="text-xs text-muted-foreground">
            Billing changes can only be made by the workspace owner.
          </p>
        )}
      </div>
    </div>
  )
}

function Stat({
  label,
  value,
  large,
}: {
  label: string
  value: string
  large?: boolean
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={cn(
          "font-medium",
          large ? "text-base font-semibold" : "text-sm",
        )}
      >
        {value}
      </span>
    </div>
  )
}
