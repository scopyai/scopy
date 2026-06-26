import { env } from "#/env"
import {
  formatComputeAllowance,
  formatPlanPriceAmount,
} from "#/lib/billing-format"

// Keep in sync with apps/api/src/modules/billing/plans.ts
const HOSTED_PLANS = {
  premium: {
    priceCents: 1999,
    monthlyCredits: 20_000_000,
  },
  ultra: {
    priceCents: 9999,
    monthlyCredits: 100_000_000,
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
      computeLabel: "Bring your own model keys",
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
      computeLabel: `${premiumCompute} of review usage included`,
      desc: "Hosted Scopy for teams getting started.",
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
      computeLabel: `${ultraCompute} of review usage included`,
      desc: "More included usage for teams that ship fast.",
      features: [
        "Everything in Premium",
        "Higher monthly review usage",
        "Priority support",
      ],
      cta: "Get started",
      href: env.appUrl,
      variant: "ghost",
      featured: false,
    },
  ]
}
