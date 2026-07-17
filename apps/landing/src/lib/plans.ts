import { env } from "#/env"
import { contactFounderHref } from "@workspace/billing/contact"
import {
  ENTERPRISE_BILLING_PLAN,
  PREMIUM_BILLING_PLAN,
  ULTRA_BILLING_PLAN,
} from "@workspace/billing/plans"
import {
  formatPlanPriceAmount,
  formatReviewCredits,
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
  const premiumCredits = formatReviewCredits(
    PREMIUM_BILLING_PLAN.monthlyCredits
  )
  const ultraCredits = formatReviewCredits(ULTRA_BILLING_PLAN.monthlyCredits)

  return [
    {
      name: "Free",
      priceLabel: "Free",
      period: "",
      computeLabel: `Self-hosted version with any LLM provider`,
      desc: "Start free, then add a paid plan for managed cloud reviews – or self-host without limits.",
      features: [
        "Bring-your-own-key support",
        "Self-host with your own model keys",
        "Full source code access",
      ],
      cta: "View on GitHub",
      href: env.githubUrl,
      variant: "ghost",
      featured: false,
    },
    {
      name: PREMIUM_BILLING_PLAN.name,
      priceLabel: formatPlanPriceAmount(PREMIUM_BILLING_PLAN.price),
      period: "/mo",
      computeLabel: `${premiumCredits} / month included`,
      desc: "Hosted Scopy for teams that ship fast.",
      features: [
        "Unlimited repositories",
        "Team workspace management",
        "Email support",
      ],
      cta: "Get started",
      href: env.appUrl,
      variant: "solid",
      featured: false,
    },
    {
      name: ULTRA_BILLING_PLAN.name,
      priceLabel: formatPlanPriceAmount(ULTRA_BILLING_PLAN.price),
      period: "/mo",
      computeLabel: `${ultraCredits} / month included`,
      desc: "More monthly credits for teams that value quality",
      features: [
        "Everything in Premium",
        "Higher monthly review credits",
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
      computeLabel: "Tailored credits for your organization",
      desc: "For teams with custom requirements, higher volume, or dedicated support needs.",
      features: [
        "Custom credits & pricing",
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
