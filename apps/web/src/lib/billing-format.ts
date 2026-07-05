function formatCurrencyAmount(
  cents: number,
  currency: string,
): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100)
}

export function formatPlanPrice(
  cents: number | null,
  currency: string | null,
): string {
  if (cents === null || currency === null) return "Custom"
  return `${formatCurrencyAmount(cents, currency)}/mo`
}

export function formatPlanPriceAmount(
  cents: number | null,
  currency: string | null,
): string {
  if (cents === null || currency === null) return "Custom"
  return formatCurrencyAmount(cents, currency)
}

export function formatUsageBalance(microcents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(microcents / 1_000_000)
}

export function formatChargeAmount(
  amount: number,
  currency: string,
): string {
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

export function formatBillingMode(): string {
  return "Plan balance"
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"]
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  )
  const value = bytes / 1024 ** exponent
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`
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
