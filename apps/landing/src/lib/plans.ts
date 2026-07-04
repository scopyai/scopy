import { env } from "#/env"
import { contactFounderHref } from "@workspace/billing/contact"
import {
  ENTERPRISE_BILLING_PLAN,
  FREE_INCLUDED_CREDIT_MICRO_USD,
  PREMIUM_BILLING_PLAN,
  ULTRA_BILLING_PLAN,
} from "@workspace/billing/plans"
import {
  formatComputeAllowance,
  formatPlanPriceAmount,
} from "#/lib/billing-format"

export type LandingPlan = {
  name: string
  priceLabel: string
  period: string
  computeLabel: string
  desc: string
  features: string[]
  cta: string
  href: string
  variant: "ghost" | "solid"
  featured: boolean
  wide?: boolean
}

export function getLandingPlans(): LandingPlan[] {
  const freeCompute = formatComputeAllowance(FREE_INCLUDED_CREDIT_MICRO_USD)
  const premiumCompute = formatComputeAllowance(
    PREMIUM_BILLING_PLAN.monthlyCredits
  )
  const ultraCompute = formatComputeAllowance(ULTRA_BILLING_PLAN.monthlyCredits)

  return [
    {
      name: "Free",
      priceLabel: "Free",
      period: "",
      computeLabel: `${freeCompute} of review usage included`,
      desc: "Start reviewing in the cloud with usage included — or self-host without limits.",
      features: [
        `${freeCompute} of hosted review usage to start`,
        "Self-host with your own model keys",
        "Full source code access",
      ],
      cta: "Get started",
      href: env.appUrl,
      variant: "ghost",
      featured: false,
    },
    {
      name: PREMIUM_BILLING_PLAN.name,
      priceLabel: formatPlanPriceAmount(PREMIUM_BILLING_PLAN.price),
      period: "/mo",
      computeLabel: `${premiumCompute} of review usage included`,
      desc: "Hosted Scopy for teams getting started.",
      features: [
        "Unlimited repositories",
        "Team workspace management",
        "Email support",
      ],
      cta: "Get started",
      href: env.appUrl,
      variant: "ghost",
      featured: false,
    },
    {
      name: ULTRA_BILLING_PLAN.name,
      priceLabel: formatPlanPriceAmount(ULTRA_BILLING_PLAN.price),
      period: "/mo",
      computeLabel: `${ultraCompute} of review usage included`,
      desc: "More included usage for teams that ship fast.",
      features: [
        "Everything in Premium",
        "Higher monthly review usage",
        "Priority support",
      ],
      cta: "Get started",
      href: env.appUrl,
      variant: "solid",
      featured: true,
    },
    {
      name: ENTERPRISE_BILLING_PLAN.name,
      priceLabel: "Custom",
      period: "",
      computeLabel: "Tailored usage for your organization",
      desc: "For teams with custom requirements, higher volume, or dedicated support needs.",
      features: [
        "Custom usage & pricing",
        "Dedicated onboarding",
        "Priority support & SLAs",
      ],
      cta: "Talk to founder",
      href: contactFounderHref,
      variant: "ghost",
      featured: false,
      wide: true,
    },
  ]
}
