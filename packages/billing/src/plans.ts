export const FREE_INCLUDED_REVIEW_CREDITS = 0

export const MINIMUM_TOP_UP_CREDITS = 10

export const calculateReviewCredits = (reviewableChangedLines: number) => {
  const lines = Math.max(0, Math.ceil(reviewableChangedLines))
  if (lines <= 2_000) return 1
  if (lines <= 5_000) return 2
  if (lines <= 10_000) return 4
  return 4 + Math.ceil((lines - 10_000) / 5_000)
}

export const PREMIUM_BILLING_PLAN = {
  slug: "premium",
  name: "Premium",
  billingPeriod: "monthly",
  price: 1999,
  currency: "USD",
  monthlyCredits: 25,
  topUpCreditUnitPriceCents: 100,
  contactSales: false,
} as const

export const ULTRA_BILLING_PLAN = {
  slug: "ultra",
  name: "Ultra",
  billingPeriod: "monthly",
  price: 9999,
  currency: "USD",
  monthlyCredits: 150,
  topUpCreditUnitPriceCents: 80,
  contactSales: false,
} as const

export const ENTERPRISE_BILLING_PLAN = {
  slug: "enterprise",
  name: "Enterprise",
  billingPeriod: "custom",
  price: null,
  currency: null,
  monthlyCredits: null,
  topUpCreditUnitPriceCents: null,
  contactSales: true,
} as const

export const PUBLIC_BILLING_PLANS = [
  PREMIUM_BILLING_PLAN,
  ULTRA_BILLING_PLAN,
  ENTERPRISE_BILLING_PLAN,
] as const
