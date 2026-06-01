export const periodGrantKey = (
  subscriptionId: string,
  productId: string,
  periodStart: Date,
) => `${subscriptionId}:${productId}:${periodStart.toISOString()}:grant`;

export const calculateResetDelta = (
  currentBalance: number,
  monthlyAllowance: number,
) => monthlyAllowance - currentBalance;

export const canConsumeCredits = (balance: number, amount: number) =>
  Number.isInteger(amount) && amount > 0 && balance >= amount;

export const retainsCreditsDuringCancellation = (
  periodEnd: Date,
  now = new Date(),
) => periodEnd.getTime() > now.getTime();

export const shouldRevokeForSubscriptionStatus = (status: string) =>
  status === "paused" || status === "expired";

export const getPlanChangeKind = (
  currentTier: string,
  targetTier: string,
) => {
  if (currentTier === targetTier) return "same";
  if (currentTier === "premium" && targetTier === "ultra") return "upgrade";
  if (currentTier === "ultra" && targetTier === "premium") return "downgrade";
  return "unsupported";
};
