import { env } from "../../env"

export const billingPlans = [
  {
    slug: "premium",
    name: "Premium",
    billingPeriod: "monthly",
    price: 500,
    currency: "USD",
    monthlyCredits: 100,
    productId: env.CREEM_PREMIUM_PRODUCT_ID,
    contactSales: false,
  },
  {
    slug: "ultra",
    name: "Ultra",
    billingPeriod: "monthly",
    price: 1000,
    currency: "USD",
    monthlyCredits: 500,
    productId: env.CREEM_ULTRA_PRODUCT_ID,
    contactSales: false,
  },
  {
    slug: "enterprise",
    name: "Enterprise",
    billingPeriod: "custom",
    price: null,
    currency: null,
    monthlyCredits: null,
    productId: null,
    contactSales: true,
  },
] as const

export type PurchasableBillingTier = "premium" | "ultra"
export type WorkspaceBillingTier =
  | "free"
  | PurchasableBillingTier
  | "enterprise"

export const isPaidTier = (
  tier: WorkspaceBillingTier,
): tier is PurchasableBillingTier => tier === "premium" || tier === "ultra"

export const getPurchasablePlan = (tier: string) =>
  billingPlans.find(
    (plan): plan is (typeof billingPlans)[0] | (typeof billingPlans)[1] =>
      plan.slug === tier && plan.productId !== null
  )

export const getPlanByProductId = (productId: string) =>
  billingPlans.find(
    (plan): plan is (typeof billingPlans)[0] | (typeof billingPlans)[1] =>
      plan.productId === productId
  )

export const getMonthlyAllowance = (tier: WorkspaceBillingTier) =>
  isPaidTier(tier) ? getPurchasablePlan(tier)?.monthlyCredits ?? 0 : 0

export const publicBillingPlans = billingPlans.map(
  ({ productId: _productId, ...plan }) => plan,
)
