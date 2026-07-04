import { env } from "#/env"
import { getAllPosts, getPost, formatPostDate } from "#/lib/blog"
import { faqs, features, hero, steps } from "#/lib/landing-content"
import { getLandingPlans } from "#/lib/plans"

function homeMarkdown(): string {
  const plans = getLandingPlans()

  const lines: string[] = [
    `# Scopy — ${hero.title}`,
    "",
    `> ${hero.subtitle}`,
    "",
    "- Website: " + env.siteUrl,
    "- Source code (GitHub): " + env.githubUrl,
    "- Documentation: " + env.docsUrl,
    "- Get started: " + env.appUrl,
    "- License: MIT",
    "",
    "## How AI code review works with Scopy",
    "",
    ...steps.map((step, i) => `${i + 1}. **${step.name}** — ${step.desc}`),
    "",
    "## Features",
    "",
    ...features.map((f) => `- **${f.name}** — ${f.desc}`),
    "",
    "## Pricing",
    "",
    "New cloud workspaces start with $1 of included review usage. Pick a monthly plan when you need ongoing reviews — no per-seat pricing.",
    "",
  ]

  for (const plan of plans) {
    const price = plan.period
      ? `${plan.priceLabel}${plan.period}`
      : plan.priceLabel
    lines.push(`### ${plan.name} — ${price}`)
    lines.push("")
    lines.push(`${plan.computeLabel}. ${plan.desc}`)
    lines.push("")
    for (const feature of plan.features) lines.push(`- ${feature}`)
    lines.push("")
  }

  lines.push("## Frequently asked questions", "")
  for (const item of faqs) {
    lines.push(`### ${item.q}`)
    lines.push("")
    lines.push(item.a)
    lines.push("")
  }

  return lines.join("\n").trimEnd() + "\n"
}

function blogIndexMarkdown(): string {
  const posts = getAllPosts()
  const lines: string[] = [
    "# Scopy blog",
    "",
    "Writing on AI code review, code quality and self-hosting Scopy.",
    "",
  ]

  for (const post of posts) {
    lines.push(`## [${post.title}](${env.siteUrl}/blog/${post.slug})`)
    lines.push("")
    lines.push(
      `_${formatPostDate(post.date)} · ${post.readingMinutes} min read_`
    )
    lines.push("")
    lines.push(post.description)
    lines.push("")
  }

  return lines.join("\n").trimEnd() + "\n"
}

function privacyMarkdown(): string {
  const url = `${env.siteUrl}/privacy`
  const terms = [
    "Acceptance of these Terms",
    "The Service",
    "Eligibility",
    "Accounts and authentication",
    "GitHub integration",
    "Acceptable use",
    "Your content and code",
    "AI-generated output",
    "Plans, billing, and payment",
    "Service changes and availability",
    "Suspension and termination",
    "Open-source software",
    "Disclaimers",
    "Limitation of liability",
    "Indemnification",
    "Governing law and disputes",
    "Changes to these Terms",
    "Contact",
  ]
  const privacy = [
    "Scope and roles",
    "Information we collect",
    "How we use information",
    "GitHub data",
    "AI processing",
    "Cookies and similar technologies",
    "International data transfers",
    "Data retention",
    "Security",
    "Automated decision-making",
    "Children's privacy",
    "Changes to this Privacy Policy",
    "Contact",
  ]

  return (
    [
      "# Terms of Service & Privacy Policy — Scopy",
      "",
      "_Last updated: June 14, 2026_",
      "",
      `This is an outline of Scopy's Terms of Service and Privacy Policy. Read the full, authoritative text at ${url}`,
      "",
      "## Terms of Service",
      "",
      ...terms.map((s, i) => `${i + 1}. ${s}`),
      "",
      "## Privacy Policy",
      "",
      ...privacy.map((s, i) => `${i + 1}. ${s}`),
    ].join("\n") + "\n"
  )
}

function blogPostMarkdown(slug: string): string | undefined {
  const post = getPost(slug)
  if (!post) return undefined

  return (
    [
      `# ${post.title}`,
      "",
      `_${formatPostDate(post.date)} · ${post.author} · ${post.readingMinutes} min read_`,
      "",
      post.markdown,
    ].join("\n") + "\n"
  )
}

function normalizePath(pathname: string): string {
  return pathname.replace(/\/+$/, "") || "/"
}

export function hasMarkdownForPath(pathname: string): boolean {
  const path = normalizePath(pathname)
  if (path === "/" || path === "/blog" || path === "/privacy") return true

  const blogPost = /^\/blog\/([^/]+)$/.exec(path)
  if (blogPost) return getPost(decodeURIComponent(blogPost[1])) !== undefined

  return false
}

/**
 * Returns a markdown representation of the given pathname, or `undefined` when
 * the route has no markdown variant (the caller should then fall back to HTML).
 */
export function getMarkdownForPath(pathname: string): string | undefined {
  const path = normalizePath(pathname)

  if (path === "/") return homeMarkdown()
  if (path === "/blog") return blogIndexMarkdown()
  if (path === "/privacy") return privacyMarkdown()

  const blogPost = /^\/blog\/([^/]+)$/.exec(path)
  if (blogPost) return blogPostMarkdown(decodeURIComponent(blogPost[1]))

  return undefined
}
