import { env } from "#/env"
import {
  formatComputeAllowance,
  formatPlanPriceAmount,
} from "#/lib/billing-format"

// Keep in sync with apps/api/src/modules/billing/plans.ts
const HOSTED_PLANS = {
  premium: {
    priceCents: 1999,
    monthlyCredits: 25_000_000,
  },
  ultra: {
    priceCents: 9999,
    monthlyCredits: 130_000_000,
  },
} as const

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
}

export function getLandingPlans(): LandingPlan[] {
  const premiumCompute = formatComputeAllowance(
    HOSTED_PLANS.premium.monthlyCredits
  )
  const ultraCompute = formatComputeAllowance(HOSTED_PLANS.ultra.monthlyCredits)

  return [
    {
      name: "Self-host",
      priceLabel: "Free",
      period: "",
      computeLabel: "Bring your own LLM keys",
      desc: "Run Scopy on your infrastructure without limits.",
      features: [
        "Unlimited pull requests",
        "Connect any LLM provider",
        "Full source code access",
      ],
      cta: "View on GitHub",
      href: env.githubUrl,
      variant: "ghost",
      featured: false,
    },
    {
      name: "Premium",
      priceLabel: formatPlanPriceAmount(HOSTED_PLANS.premium.priceCents),
      period: "/mo",
      computeLabel: `${premiumCompute} of compute included`,
      desc: "Hosted option for teams who start their journey.",
      features: [
        "Unlimited repositories",
        "Team workspace management",
        "Email support",
      ],
      cta: "Get started",
      href: env.appUrl,
      variant: "solid",
      featured: true,
    },
    {
      name: "Ultra",
      priceLabel: formatPlanPriceAmount(HOSTED_PLANS.ultra.priceCents),
      period: "/mo",
      computeLabel: `${ultraCompute} of compute included`,
      desc: "More monthly compute for teams that ship fast.",
      features: [
        "Everything in Premium",
        "More than 5× monthly compute",
        "Priority support",
      ],
      cta: "Get started",
      href: env.appUrl,
      variant: "ghost",
      featured: false,
    },
  ]
}
