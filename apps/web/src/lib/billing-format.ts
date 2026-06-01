export function formatPlanPrice(
  cents: number | null,
  currency: string | null,
): string {
  if (cents === null || currency === null) return "Custom"
  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
  return `${formatter.format(cents / 100)}/mo`
}

export function formatCredits(n: number): string {
  return n.toLocaleString("en-US")
}

export function formatLedgerEventType(
  eventType: "grant" | "consume" | "revoke" | "adjustment",
): string {
  return {
    grant: "Grant",
    consume: "Consumed",
    revoke: "Revoked",
    adjustment: "Adjustment",
  }[eventType]
}

export function formatLedgerDelta(delta: number): string {
  return delta > 0 ? `+${delta}` : String(delta)
}

export function formatPeriodEnd(date: Date | string | null): string {
  if (!date) return ""
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(date))
}

export function formatDate(date: Date | string | null): string {
  if (!date) return ""
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(date))
}
