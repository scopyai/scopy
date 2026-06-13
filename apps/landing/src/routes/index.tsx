import { createFileRoute } from '@tanstack/react-router'
import {
  CodeIcon,
  ZapIcon,
  GitBranchIcon,
  FilterIcon,
  ArrowUpRightIcon,
} from 'lucide-react'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  return (
    <>
      <LandingNav />
      <main>
        <Hero />
        <Features />
        <OpenSource />
        <Pricing />
        <FinalCTA />
      </main>
      <LandingFooter />
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Nav
// ─────────────────────────────────────────────────────────────────────────────

function LandingNav() {
  return (
    <nav className="l-nav">
      <div className="l-wrap">
        <div className="l-nav-row">
          <a href="/" className="l-logo">
            <span className="l-logo-mark" aria-hidden="true" />
            scopy
          </a>
          <div className="l-nav-right">
            <a
              href="https://github.com/your-org/scopy"
              className="l-nav-a"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub
            </a>
            <a href="/docs" className="l-nav-a">
              Docs
            </a>
            <a href="/app" className="l-btn l-btn-solid" style={{ marginLeft: 6 }}>
              Get started
            </a>
          </div>
        </div>
      </div>
    </nav>
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
          <h1 className="l-hero-title">
            Code review that earns its keep.
          </h1>

          <p className="l-hero-sub">
            scopy reads pull requests with full context — like a senior
            engineer, not a linter. Open-source and works with any model.
          </p>

          <div className="l-hero-ctas">
            <a
              href="https://github.com/your-org/scopy"
              className="l-btn l-btn-ghost l-btn-lg"
              target="_blank"
              rel="noopener noreferrer"
            >
              <GitBranchIcon size={16} />
              View on GitHub
            </a>
            <a href="/app" className="l-btn l-btn-solid l-btn-lg">
              Get started
              <ArrowUpRightIcon size={16} />
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
      <span className="l-shard" style={{ width: 108, height: 108, top: '12%', left: '3%',    opacity: 0.08 }} />
      <span className="l-shard" style={{ width: 52,  height: 52,  top: '55%', left: '7.5%',  opacity: 0.06 }} />
      <span className="l-shard" style={{ width: 68,  height: 68,  top: '75%', left: '2%',    opacity: 0.05 }} />
      <span className="l-shard" style={{ width: 92,  height: 92,  top: '8%',  right: '4%',   opacity: 0.08 }} />
      <span className="l-shard" style={{ width: 40,  height: 40,  top: '60%', right: '8%',   opacity: 0.06 }} />
      <span className="l-shard" style={{ width: 120, height: 120, top: '78%', right: '1.5%', opacity: 0.04 }} />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Features
// ─────────────────────────────────────────────────────────────────────────────

const FEATURES = [
  {
    icon: <CodeIcon size={22} />,
    name: 'Context-first analysis',
    desc: 'scopy reads the full pull request — not just changed lines. It understands intent, surface area, and downstream risk before it writes a word.',
  },
  {
    icon: <ZapIcon size={22} />,
    name: 'Bring your own model',
    desc: 'Plug in OpenAI, Anthropic, local models, or anything with a compatible API. No lock-in, no hidden compute markup. Or let us handle inference.',
  },
  {
    icon: <GitBranchIcon size={22} />,
    name: 'Native GitHub comments',
    desc: 'Reviews appear as inline PR comments on the exact lines that matter. No separate dashboard to check, no extra tab during code review.',
  },
  {
    icon: <FilterIcon size={22} />,
    name: 'Signal, not noise',
    desc: 'Configurable severity filters keep feedback focused on actual bugs and risky patterns — not style preferences or things you already know.',
  },
]

function Features() {
  return (
    <section className="l-feat l-section">
      <div className="l-wrap">
        <div className="l-feat-header">
          <h2 className="l-feat-title">
            Built for teams that care about quality.
          </h2>
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
          <h2 className="l-oss-title">Built in the open.</h2>
          <p className="l-oss-sub">
            scopy's full source lives on GitHub. Audit the prompts, fork the
            logic, run it in your own infrastructure — or just sign up and let
            us handle it.
          </p>
        </div>

        <div className="l-oss-box">
          <div className="l-oss-col">
            <h3 className="l-oss-col-title">Run it on your infrastructure</h3>
            <p className="l-oss-col-body">
              Full source code, MIT licensed. No data leaves your environment.
              Connect any LLM provider, configure review rules, own the whole stack.
            </p>
            <ul className="l-oss-list">
              <li>MIT licensed, full source code</li>
              <li>Connect any LLM provider</li>
              <li>Your data stays in your environment</li>
              <li>Community support on GitHub</li>
            </ul>
            <a
              href="https://github.com/your-org/scopy"
              className="l-btn l-btn-ghost"
              style={{ alignSelf: 'flex-start', marginTop: 8 }}
              target="_blank"
              rel="noopener noreferrer"
            >
              <GitBranchIcon size={14} />
              Star on GitHub
            </a>
          </div>

          <div className="l-oss-col">
            <h3 className="l-oss-col-title">Or let us run it for you</h3>
            <p className="l-oss-col-body">
              Connect GitHub in seconds, pick a plan, and start getting reviews
              immediately. AI compute included — no API keys required.
            </p>
            <ul className="l-oss-list">
              <li>Sign in with GitHub in seconds</li>
              <li>AI compute included in plan</li>
              <li>Unlimited repositories</li>
              <li>Team workspace management</li>
            </ul>
            <a
              href="/app"
              className="l-btn l-btn-solid"
              style={{ alignSelf: 'flex-start', marginTop: 8 }}
            >
              Start free
              <ArrowUpRightIcon size={14} />
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

const PLANS = [
  {
    name: 'Self-host',
    price: 'Free',
    period: '',
    desc: 'Open-source, MIT licensed. Run scopy on your own infrastructure with your own model keys.',
    features: [
      'Unlimited pull requests',
      'Bring your own LLM key',
      'Full source code access',
      'Community support',
    ],
    cta: 'View on GitHub',
    href: 'https://github.com/your-org/scopy',
    variant: 'ghost' as const,
    featured: false,
    external: true,
  },
  {
    name: 'Premium',
    price: '$29',
    period: '/mo',
    desc: 'Hosted reviews with AI compute included. For teams that ship every day.',
    features: [
      'AI reviews on every PR',
      'Unlimited repositories',
      'Team workspace',
      'Priority email support',
    ],
    cta: 'Get started',
    href: '/app',
    variant: 'solid' as const,
    featured: true,
    external: false,
  },
  {
    name: 'Ultra',
    price: '$99',
    period: '/mo',
    desc: '5× the monthly usage allowance. Built for high-volume engineering teams.',
    features: [
      'Everything in Premium',
      '5× monthly usage',
      'Custom review rules',
      'Priority support & SLAs',
    ],
    cta: 'Get started',
    href: '/app',
    variant: 'ghost' as const,
    featured: false,
    external: false,
  },
]

function Pricing() {
  return (
    <section className="l-price l-section">
      <div className="l-wrap">
        <div className="l-price-header">
          <h2 className="l-price-title">Simple, honest pricing.</h2>
          <p className="l-price-sub">
            Start for free by self-hosting. Upgrade to a hosted plan when you
            want managed infrastructure and compute.
          </p>
        </div>

        <div className="l-price-grid">
          {PLANS.map((plan) => (
            <div
              key={plan.name}
              className={`l-plan${plan.featured ? ' l-plan-featured' : ''}`}
            >
              <div>
                <div className="l-plan-name">{plan.name}</div>
                <div className="l-plan-price-row">
                  <span className="l-plan-price">{plan.price}</span>
                  {plan.period && (
                    <span className="l-plan-period">{plan.period}</span>
                  )}
                </div>
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
                target={plan.external ? '_blank' : undefined}
                rel={plan.external ? 'noopener noreferrer' : undefined}
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
// Final CTA
// ─────────────────────────────────────────────────────────────────────────────

function FinalCTA() {
  return (
    <section className="l-cta l-section">
      <div className="l-wrap">
        <div className="l-cta-inner">
          <h2 className="l-cta-title">Start reviewing smarter.</h2>
          <p className="l-cta-sub">
            Setup takes under five minutes. Your first pull request review is on
            us.
          </p>
          <div className="l-cta-btns">
            <a
              href="https://github.com/your-org/scopy"
              className="l-btn l-btn-ghost l-btn-lg"
              target="_blank"
              rel="noopener noreferrer"
            >
              <GitBranchIcon size={16} />
              Star on GitHub
            </a>
            <a href="/app" className="l-btn l-btn-solid l-btn-lg">
              Get started
              <ArrowUpRightIcon size={16} />
            </a>
          </div>
        </div>
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Footer
// ─────────────────────────────────────────────────────────────────────────────

function LandingFooter() {
  return (
    <footer className="l-footer">
      <div className="l-wrap">
        <div className="l-footer-row">
          <span className="l-footer-copy">
            © {new Date().getFullYear()} scopy · Open-source AI code review
          </span>
          <nav className="l-footer-links">
            <a
              href="https://github.com/your-org/scopy"
              className="l-footer-a"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub
            </a>
            <a href="/docs" className="l-footer-a">
              Docs
            </a>
            <a href="/privacy" className="l-footer-a">
              Privacy
            </a>
          </nav>
        </div>
      </div>
    </footer>
  )
}
