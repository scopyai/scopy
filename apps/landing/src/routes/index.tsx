import { createFileRoute } from "@tanstack/react-router"
import { CodeIcon, ZapIcon, FilterIcon, ArrowRight } from "lucide-react"
import { useState } from "react"
import { GitHubIcon } from "#/components/github-icon"
import { LandingFooter, LandingNav } from "#/components/landing-chrome"
import { env, externalLinkProps } from "#/env"
import { getLandingPlans } from "#/lib/plans"

export const Route = createFileRoute("/")({ component: Home })

function Home() {
  return (
    <>
      <LandingNav />
      <main>
        <Hero />
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
      <Shards />
      <div className="l-wrap">
        <div className="l-hero-body">
          <h1 className="l-hero-title">Open-source AI code reviewer</h1>

          <p className="l-hero-sub">
            Scopy works with your codebase to find bugs and improve code
            quality.
          </p>

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
              Start in cloud
              <ArrowRight size={16} />
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}

function Shards() {
  return (
    <div className="l-shards" aria-hidden="true">
      <span
        className="l-shard"
        style={{
          width: 108,
          height: 108,
          top: "12%",
          left: "3%",
          opacity: 0.08,
        }}
      />
      <span
        className="l-shard"
        style={{
          width: 52,
          height: 52,
          top: "55%",
          left: "7.5%",
          opacity: 0.06,
        }}
      />
      <span
        className="l-shard"
        style={{ width: 68, height: 68, top: "75%", left: "2%", opacity: 0.05 }}
      />
      <span
        className="l-shard"
        style={{ width: 92, height: 92, top: "8%", right: "4%", opacity: 0.08 }}
      />
      <span
        className="l-shard"
        style={{
          width: 40,
          height: 40,
          top: "60%",
          right: "8%",
          opacity: 0.06,
        }}
      />
      <span
        className="l-shard"
        style={{
          width: 120,
          height: 120,
          top: "78%",
          right: "1.5%",
          opacity: 0.04,
        }}
      />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Features
// ─────────────────────────────────────────────────────────────────────────────

const FEATURES = [
  {
    icon: <CodeIcon size={22} />,
    name: "Full-context analysis",
    desc: "Scopy reads the full pull request to understand intent, surface area and downstream risk before it writes a word.",
  },
  {
    icon: <ZapIcon size={22} />,
    name: "Model-agnostic",
    desc: "Self-host with OpenAI, Anthropic, local models or anything with a compatible API. No model lock-in.",
  },
  {
    icon: <GitHubIcon size={22} className="l-icon" />,
    name: "Right in your PR",
    desc: "Inline comments on the lines that matter — right in your PR.",
  },
  {
    icon: <FilterIcon size={22} />,
    name: "Configurable",
    desc: "Set custom linting rules and review criteria to fit your team's needs.",
  },
]

function Features() {
  return (
    <section className="l-feat l-section">
      <div className="l-wrap">
        <div className="l-feat-header">
          <h2 className="l-feat-title">For devs who care about code quality</h2>
        </div>

        <div className="l-feat-grid">
          {FEATURES.map((f) => (
            <div key={f.name} className="l-feat-card">
              <div className="l-feat-icon">{f.icon}</div>
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
            <h3 className="l-oss-col-title">Use Scopy in cloud</h3>
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
              Start free
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
            Hosted Scopy includes monthly review usage with no per-seat pricing.
          </p>
        </div>

        <div className="l-price-grid">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={plan.featured ? "l-plan l-plan-featured" : "l-plan"}
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

const FAQS = [
  {
    q: "How does Scopy work?",
    a: "Scopy runs reviews where your team already works. It builds context from the pull request diff, affected symbols and repository files in general, then returns actionable findings back to you.",
  },
  {
    q: "When does Scopy run a review?",
    a: "Reviews run automatically for enabled repositories when relevant pull request activity arrives from GitHub, such as a new pull request or a draft PR being marked ready for review. You can also request a fresh review by mentioning Scopy in a PR comment.",
  },
  {
    q: "What GitHub access does Scopy need?",
    a: "Scopy uses a GitHub App installation to receive webhook events, read repository metadata and code for selected repositories, and publish pull request feedback. GitHub controls which repositories are visible to the app, and Scopy can only review repositories granted to that installation.",
  },
  {
    q: "How does billing work?",
    a: "Billing is managed per workspace. Hosted Scopy plans include review credits, and reviews debit workspace credits based on the actual usage recorded during review runs. This means, you pay only for what you actually utilize, not a fixed monthly fee. Billing changes apply to the selected workspace, not every workspace on your account.",
  },
  {
    q: "Can we self-host Scopy?",
    a: "Yes. Scopy is MIT licensed and the source code is available on GitHub. Self-hosting lets you run Scopy on your own infrastructure and connect your preferred model provider.",
  },
  {
    q: "Are reviews customizable?",
    a: "Yes. You can configure repositories and review criteria so Scopy focuses on the rules and risks that matter for your team, including custom linting guidance and review settings.",
  },
] as const

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
          <h2 className="l-cta-title">Catch more bugs</h2>
          <p className="l-cta-sub">Setup usually takes under five minutes.</p>
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
              Start in cloud
              <ArrowRight size={16} />
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}
