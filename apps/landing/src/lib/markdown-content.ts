import { env } from "#/env"
import { getAllPosts, getPost, formatPostDate } from "#/lib/blog"
import { faqs, features, hero, steps } from "#/lib/landing-content"
import { getLandingPlans } from "#/lib/plans"

function homeMarkdown(): string {
  const plans = getLandingPlans()

  const lines: string[] = [
    `# Scopy AI — ${hero.title}`,
    "",
    `> ${hero.subtitle}`,
    "",
    "- Website: " + env.siteUrl,
    "- Source code (GitHub): " + env.githubUrl,
    "- Documentation: " + env.docsUrl,
    "- Get started: " + env.appUrl,
    "- License: MIT",
    "",
    "## How code review works with Scopy",
    "",
    ...steps.map((step, i) => `${i + 1}. **${step.name}** — ${step.desc}`),
    "",
    "## Features",
    "",
    ...features.map((f) => `- **${f.name}** — ${f.desc}`),
    "",
    "## Pricing",
    "",
    "Reviews use credits based on reviewable changed lines. Pick a monthly plan when you need managed cloud reviews — no per-seat pricing.",
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
    "# Scopy AI team blog",
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
  if (path === "/" || path === "/blog") return true

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

  const blogPost = /^\/blog\/([^/]+)$/.exec(path)
  if (blogPost) return blogPostMarkdown(decodeURIComponent(blogPost[1]))

  return undefined
}
