import { createFileRoute } from "@tanstack/react-router"
import { FREE_INCLUDED_CREDIT_MICRO_USD } from "@workspace/billing/plans"
import {
  CodeIcon,
  ZapIcon,
  FilterIcon,
  ArrowRight,
  GitPullRequestIcon,
  MessageSquareIcon,
  PlugIcon,
} from "lucide-react"
import { useState } from "react"
import { GitHubIcon } from "#/components/github-icon"
import { LandingFooter, LandingNav } from "#/components/landing-chrome"
import { env, externalLinkProps } from "#/env"
import {
  faqs as FAQS,
  features as FEATURES,
  hero,
  steps as STEPS,
} from "#/lib/landing-content"
import { formatComputeAllowance } from "#/lib/billing-format"
import { getLandingPlans } from "#/lib/plans"

export const Route = createFileRoute("/")({
  head: () => ({
    links: [{ rel: "canonical", href: env.siteUrl }],
  }),
  component: Home,
})

function Home() {
  return (
    <>
      <LandingNav />
      <main>
        <Hero />
        <HowItWorks />
        <Features />
        <OpenSource />
        <Pricing />
        <FAQ />
        <FinalCTA />
      </main>
      <FAQJsonLd />
      <LandingFooter />
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Hero
// ─────────────────────────────────────────────────────────────────────────────

function Hero() {
  return (
    <section className="l-hero">
      <div className="l-wrap">
        <div className="l-hero-body">
          <h1 className="l-hero-title">{hero.title}</h1>

          <p className="l-hero-sub">{hero.subtitle}</p>

          <div className="l-hero-ctas">
            <a
              href={env.githubUrl}
              className="l-btn l-btn-ghost l-btn-lg"
              {...externalLinkProps(env.githubUrl)}
            >
              <GitHubIcon size={16} className="l-icon" />
              View on GitHub
            </a>
            <a
              href={env.appUrl}
              className="l-btn l-btn-solid l-btn-lg"
              {...externalLinkProps(env.appUrl)}
            >
              Get started
              <ArrowRight size={16} />
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// How it works
// ─────────────────────────────────────────────────────────────────────────────

const STEP_ICONS = [
  <PlugIcon size={22} />,
  <GitPullRequestIcon size={22} />,
  <MessageSquareIcon size={22} />,
]

function HowItWorks() {
  return (
    <section className="l-how l-section" id="how-it-works">
      <div className="l-wrap">
        <div className="l-how-header">
          <h2 className="l-how-title">How code review works with Scopy AI</h2>
          <p className="l-how-sub">
            From connecting a repository to your first reviewed pull request in
            three steps — no change to how your team already works.
          </p>
        </div>

        <ol className="l-how-grid">
          {STEPS.map((step, i) => (
            <li key={step.name} className="l-how-card">
              <div className="l-how-head">
                <div className="l-how-icon">{STEP_ICONS[i]}</div>
                <h3 className="l-how-name">{step.name}</h3>
              </div>
              <p className="l-how-desc">{step.desc}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Features
// ─────────────────────────────────────────────────────────────────────────────

const FEATURE_ICONS = [
  <CodeIcon size={22} />,
  <ZapIcon size={22} />,
  <GitHubIcon size={22} className="l-icon" />,
  <FilterIcon size={22} />,
]

function Features() {
  return (
    <section className="l-feat l-section">
      <div className="l-wrap">
        <div className="l-feat-header">
          <h2 className="l-feat-title">For devs who care about code quality</h2>
          <p className="l-feat-sub">
            Automated pull request reviews that understand your whole codebase —
            not just the diff.
          </p>
        </div>

        <div className="l-feat-grid">
          {FEATURES.map((f, i) => (
            <div key={f.name} className="l-feat-card">
              <div className="l-feat-icon">{FEATURE_ICONS[i]}</div>
              <div className="l-feat-name">{f.name}</div>
              <p className="l-feat-desc">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Open source
// ─────────────────────────────────────────────────────────────────────────────

function OpenSource() {
  return (
    <section className="l-oss l-section">
      <div className="l-wrap">
        <div className="l-oss-top">
          <h2 className="l-oss-title">Built in the open</h2>
          <p className="l-oss-sub">
            Full source lives on GitHub. Submit an issue, fork the repo or run
            Scopy on your own infrastructure.
          </p>
        </div>

        <div className="l-oss-box">
          <div className="l-oss-col">
            <h3 className="l-oss-col-title">Self-host</h3>
            {/*<p className="l-oss-col-body">
              Full source code, MIT licensed. No data leaves your environment.
              Connect any LLM provider, configure review rules, own the whole
              stack.
            </p>*/}
            <ul className="l-oss-list">
              <li>MIT licensed, full source code</li>
              <li>Connect any LLM provider</li>
              <li>Your data stays in your environment</li>
              <li>Community support on GitHub</li>
            </ul>
            <a
              href={env.githubUrl}
              className="l-btn l-btn-ghost"
              {...externalLinkProps(env.githubUrl)}
            >
              <GitHubIcon size={14} className="l-icon" />
              View on GitHub
            </a>
          </div>

          <div className="l-oss-col">
            <h3 className="l-oss-col-title">Use Scopy AI in cloud</h3>
            {/*<p className="l-oss-col-body">
              Connect GitHub in seconds, pick a plan, and start getting reviews
              immediately. Compute included — no API keys required.
            </p>*/}
            <ul className="l-oss-list">
              <li>Sign in with GitHub in seconds</li>
              <li>Review usage included in plan</li>
              <li>Unlimited repositories</li>
              <li>Team workspace management</li>
            </ul>
            <a
              href={env.appUrl}
              className="l-btn l-btn-solid"
              {...externalLinkProps(env.appUrl)}
            >
              Get started
              <ArrowRight size={14} />
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Pricing
// ─────────────────────────────────────────────────────────────────────────────

function Pricing() {
  const plans = getLandingPlans()

  return (
    <section className="l-price l-section">
      <div className="l-wrap">
        <div className="l-price-header">
          <h2 className="l-price-title">Simple usage-based pricing</h2>
          <p className="l-price-sub">
            New cloud workspaces start free with{" "}
            {formatComputeAllowance(FREE_INCLUDED_CREDIT_MICRO_USD)} of included
            review usage. Pick a monthly plan when you need ongoing reviews — no
            per-seat pricing.
          </p>
        </div>

        <div className="l-price-grid">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={
                plan.featured
                  ? "l-plan l-plan-featured"
                  : plan.wide
                    ? "l-plan l-plan-wide"
                    : "l-plan"
              }
            >
              <div className="l-plan-head">
                <div className="l-plan-name">{plan.name}</div>
                <div className="l-plan-price-row">
                  <span className="l-plan-price">{plan.priceLabel}</span>
                  {plan.period && (
                    <span className="l-plan-period">{plan.period}</span>
                  )}
                </div>
                <p className="l-plan-compute">{plan.computeLabel}</p>
              </div>

              <p className="l-plan-desc">{plan.desc}</p>

              <ul className="l-plan-feats">
                {plan.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>

              <a
                href={plan.href}
                className={`l-btn l-btn-${plan.variant}`}
                {...externalLinkProps(plan.href)}
              >
                {plan.cta}
              </a>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// FAQ
// ─────────────────────────────────────────────────────────────────────────────

function FAQ() {
  return (
    <section className="l-faq l-section">
      <div className="l-wrap">
        <div className="l-faq-grid">
          <div className="l-faq-head">
            <h2 className="l-faq-title">Frequently asked questions</h2>
            <p className="l-faq-sub">
              The basics on access, reviews, billing and deployment.
            </p>
          </div>

          <div className="l-faq-list">
            {FAQS.map((item, index) => (
              <FAQItem key={item.q} item={item} index={index} />
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

function FAQItem({
  item,
  index,
}: {
  item: (typeof FAQS)[number]
  index: number
}) {
  const [isOpen, setIsOpen] = useState(false)
  const answerId = `faq-answer-${index}`

  return (
    <div className="l-faq-item" data-open={isOpen ? "true" : "false"}>
      <button
        type="button"
        className="l-faq-question"
        aria-expanded={isOpen}
        aria-controls={answerId}
        onClick={() => setIsOpen((open) => !open)}
      >
        {item.q}
      </button>
      <div id={answerId} className="l-faq-answer-shell">
        <div className="l-faq-answer-inner">
          <p className="l-faq-answer">{item.a}</p>
        </div>
      </div>
    </div>
  )
}

function FAQJsonLd() {
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQS.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.a,
      },
    })),
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
    />
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Final CTA
// ─────────────────────────────────────────────────────────────────────────────

function FinalCTA() {
  return (
    <section className="l-cta l-section">
      <div className="l-wrap">
        <div className="l-cta-inner">
          <h2 className="l-cta-title">Catch more bugs.</h2>
          <div className="l-cta-btns">
            <a
              href={env.githubUrl}
              className="l-btn l-btn-ghost l-btn-lg"
              {...externalLinkProps(env.githubUrl)}
            >
              <GitHubIcon size={16} className="l-icon" />
              View on GitHub
            </a>
            <a
              href={env.appUrl}
              className="l-btn l-btn-solid l-btn-lg"
              {...externalLinkProps(env.appUrl)}
            >
              Get started
              <ArrowRight size={16} />
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}
