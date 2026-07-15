import { apiEnv as env } from "../../env"
import {
  ENTERPRISE_BILLING_PLAN,
  PREMIUM_BILLING_PLAN,
  PUBLIC_BILLING_PLANS,
  ULTRA_BILLING_PLAN,
} from "@workspace/billing/plans"

export const billingPlans = [
  {
    ...PREMIUM_BILLING_PLAN,
    productId: env.CREEM_PREMIUM_PRODUCT_ID,
  },
  {
    ...ULTRA_BILLING_PLAN,
    productId: env.CREEM_ULTRA_PRODUCT_ID,
  },
  {
    ...ENTERPRISE_BILLING_PLAN,
    productId: null,
  },
] as const

export type PurchasableBillingTier = "premium" | "ultra"
export type WorkspaceBillingTier =
  | "free"
  | PurchasableBillingTier
  | "enterprise"

export const isPaidTier = (
  tier: WorkspaceBillingTier
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
  isPaidTier(tier) ? (getPurchasablePlan(tier)?.monthlyCredits ?? 0) : 0

export const publicBillingPlans = PUBLIC_BILLING_PLANS
