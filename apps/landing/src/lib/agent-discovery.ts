import { env } from "#/env"

type AcceptEntry = { type: string; q: number }

function parseAccept(accept: string): AcceptEntry[] {
  return accept.split(",").map((part) => {
    const [type, ...params] = part.trim().split(";")
    let q = 1
    for (const param of params) {
      const match = /^\s*q=([0-9]*\.?[0-9]+)\s*$/i.exec(param)
      if (match) q = Number.parseFloat(match[1])
    }
    return { type: type.trim().toLowerCase(), q: Number.isFinite(q) ? q : 0 }
  })
}

export function prefersMarkdown(accept: string | null | undefined): boolean {
  if (!accept) return false
  const entries = parseAccept(accept)
  const qOf = (type: string): number => {
    const matches = entries.filter((e) => e.type === type).map((e) => e.q)
    return matches.length ? Math.max(...matches) : -1
  }

  const markdown = Math.max(qOf("text/markdown"), qOf("text/*"))
  if (markdown <= 0) return false

  const html = Math.max(
    qOf("text/html"),
    qOf("application/xhtml+xml"),
    qOf("*/*")
  )
  return markdown >= html
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function absoluteUrl(pathname: string): string {
  const path = pathname === "/" ? "" : pathname
  return `${env.siteUrl}${path}`
}

export type Representation = "html" | "markdown"

export function buildLinkHeader(
  pathname: string,
  opts: { representation: Representation; hasMarkdown?: boolean }
): string {
  const links = [
    `</sitemap.xml>; rel="sitemap"`,
    `<${env.docsUrl}>; rel="service-doc"`,
    `</privacy>; rel="privacy-policy"`,
    `<https://opensource.org/license/mit>; rel="license"`,
  ]

  if (opts.representation === "html") {
    if (opts.hasMarkdown) {
      links.push(`<${pathname || "/"}>; rel="alternate"; type="text/markdown"`)
    }
  } else {
    links.push(`<${absoluteUrl(pathname)}>; rel="canonical"`)
  }

  return links.join(", ")
}
