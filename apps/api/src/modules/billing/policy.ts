export const periodResetKey = (
  subscriptionId: string,
  productId: string,
  periodStart: Date,
) => `${subscriptionId}:${productId}:${periodStart.toISOString()}:reset`;

export const shouldRevokeForSubscriptionStatus = (status: string) =>
  status === "paused" || status === "expired" || status === "canceled";

export const isStaleCreemEvent = (
  lastEventAt: Date | null,
  eventAt: Date,
) => lastEventAt !== null && lastEventAt.getTime() > eventAt.getTime();

export const getWorkspaceReferenceId = (
  metadata: Record<string, string | number | null> | undefined,
) => typeof metadata?.referenceId === "string" ? metadata.referenceId : null;

export const getPlanChangeKind = (
  currentTier: string,
  targetTier: string,
) => {
  if (currentTier === targetTier) return "same";
  if (currentTier === "premium" && targetTier === "ultra") return "upgrade";
  if (currentTier === "ultra" && targetTier === "premium") return "downgrade";
  return "unsupported";
};
