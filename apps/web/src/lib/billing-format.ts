function formatCurrencyAmount(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100)
}

export function formatPlanPriceAmount(
  cents: number | null,
  currency: string | null
): string {
  if (cents === null || currency === null) return "Custom"
  return formatCurrencyAmount(cents, currency)
}

export function formatReviewCredits(credits: number): string {
  return `${credits.toLocaleString("en-US")} credit${credits === 1 ? "" : "s"}`
}

export function formatChargeAmount(amount: number, currency: string): string {
  return formatCurrencyAmount(amount, currency.toUpperCase())
}

export function formatChargeType(type: string): string {
  const labels: Record<string, string> = {
    payment: "Payment",
    refund: "Refund",
    dispute: "Dispute",
  }
  return labels[type] ?? type
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
