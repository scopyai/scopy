export const FREE_INCLUDED_CREDIT_MICRO_USD = 1_000_000

export const PREMIUM_BILLING_PLAN = {
  slug: "premium",
  name: "Premium",
  billingPeriod: "monthly",
  price: 1999,
  currency: "USD",
  monthlyCredits: 20_000_000,
  contactSales: false,
} as const

export const ULTRA_BILLING_PLAN = {
  slug: "ultra",
  name: "Ultra",
  billingPeriod: "monthly",
  price: 9999,
  currency: "USD",
  monthlyCredits: 100_000_000,
  contactSales: false,
} as const

export const ENTERPRISE_BILLING_PLAN = {
  slug: "enterprise",
  name: "Enterprise",
  billingPeriod: "custom",
  price: null,
  currency: null,
  monthlyCredits: null,
  contactSales: true,
} as const

export const PUBLIC_BILLING_PLANS = [
  PREMIUM_BILLING_PLAN,
  ULTRA_BILLING_PLAN,
  ENTERPRISE_BILLING_PLAN,
] as const
