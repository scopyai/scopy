export function formatPlanPrice(
  cents: number | null,
  currency: string | null,
): string {
  if (cents === null || currency === null) return "Custom"
  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })
  return `${formatter.format(cents / 100)}/mo`
}

export function formatUsageBalance(microcents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(microcents / 1_000_000)
}

export function formatCreditTransactionType(
  eventType: "reset" | "revoke" | "usage_debit" | "usage_week",
): string {
  return {
    reset: "Allowance reset",
    revoke: "Revoked",
    usage_debit: "Review usage",
    usage_week: "Review usage",
  }[eventType]
}

export function formatCreditTransactionAmount(microcents: number): string {
  const formatted = formatUsageBalance(Math.abs(microcents))
  if (microcents === 0) return formatted
  return microcents > 0 ? `+${formatted}` : `-${formatted}`
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

export function formatDateRange(
  start: Date | string | null,
  end: Date | string | null,
): string {
  if (!start || !end) return formatDate(start)
  const startDate = new Date(start)
  const endDate = new Date(end)
  endDate.setDate(endDate.getDate() - 1)
  const formatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
  return `${formatter.format(startDate)} - ${formatter.format(endDate)}`
}
