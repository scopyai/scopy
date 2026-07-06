export function formatPlanPriceAmount(
  cents: number | null,
  currency = "USD"
): string {
  if (cents === null) return "Custom"
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100)
}

export function formatReviewCredits(credits: number): string {
  return `${credits.toLocaleString("en-US")} credit${credits === 1 ? "" : "s"}`
}
