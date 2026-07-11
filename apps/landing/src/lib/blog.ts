import hljs from "highlight.js/lib/core"
import bash from "highlight.js/lib/languages/bash"
import go from "highlight.js/lib/languages/go"
import json from "highlight.js/lib/languages/json"
import markdown from "highlight.js/lib/languages/markdown"
import python from "highlight.js/lib/languages/python"
import rust from "highlight.js/lib/languages/rust"
import typescript from "highlight.js/lib/languages/typescript"
import { marked } from "marked"

hljs.registerLanguage("bash", bash)
hljs.registerLanguage("go", go)
hljs.registerLanguage("json", json)
hljs.registerLanguage("markdown", markdown)
hljs.registerLanguage("python", python)
hljs.registerLanguage("rust", rust)
hljs.registerLanguage("typescript", typescript)
hljs.registerAliases(["sh", "shell"], { languageName: "bash" })
hljs.registerAliases(["md"], { languageName: "markdown" })
hljs.registerAliases(["py"], { languageName: "python" })
hljs.registerAliases(["ts", "tsx", "js", "jsx"], {
  languageName: "typescript",
})

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

const SAFE_URL_SCHEMES = new Set(["http", "https", "mailto"])

function isSafeUrl(url: string): boolean {
  const cleaned = url.replace(/[\u0000-\u0020]/g, "").toLowerCase()
  const scheme = /^([a-z][a-z0-9+.-]*):/.exec(cleaned)
  if (!scheme) return true
  return SAFE_URL_SCHEMES.has(scheme[1])
}

export type BlogPost = {
  slug: string
  title: string
  description: string
  cover?: string
  coverAlt?: string
  date: string
  author: string
  tags: string[]
  readingMinutes: number
  html: string
  markdown: string
}

type Frontmatter = {
  title: string
  description: string
  cover?: string
  coverAlt?: string
  date: string
  author?: string
  tags?: string
}

const rawPosts = import.meta.glob("../content/blog/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>

marked.setOptions({ gfm: true, breaks: false })
marked.use({
  renderer: {
    html({ text }) {
      return escapeHtml(text)
    },
    code({ text, lang }) {
      const requestedLanguage = lang?.trim().split(/\s+/)[0]
      const result =
        requestedLanguage && hljs.getLanguage(requestedLanguage)
          ? hljs.highlight(text, { language: requestedLanguage })
          : hljs.highlightAuto(text)

      return `<div class="l-code-block"><button type="button" class="l-code-copy" data-copy-code aria-label="Copy code to clipboard"><svg class="l-code-copy-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg><svg class="l-code-copy-check" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg></button><pre><code class="hljs">${result.value}</code></pre></div>`
    },
  },
  walkTokens(token) {
    if (
      (token.type === "link" || token.type === "image") &&
      typeof token.href === "string" &&
      !isSafeUrl(token.href)
    ) {
      token.href = "#"
    }
  },
})

function parseFrontmatter(raw: string): { data: Frontmatter; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw)
  if (!match) {
    throw new Error("Blog post is missing frontmatter")
  }

  const data: Record<string, string> = {}
  for (const line of match[1].split(/\r?\n/)) {
    const sep = line.indexOf(":")
    if (sep === -1) continue
    const key = line.slice(0, sep).trim()
    let value = line.slice(sep + 1).trim()
    value = value.replace(/^["']|["']$/g, "")
    data[key] = value
  }

  return { data: data as Frontmatter, body: match[2] }
}

function slugFromPath(path: string): string {
  return path.replace(/^.*\/(.+)\.md$/, "$1")
}

function readingMinutes(body: string): number {
  const words = body.trim().split(/\s+/).length
  return Math.max(1, Math.round(words / 200))
}

function buildPost(path: string, raw: string): BlogPost {
  const { data, body } = parseFrontmatter(raw)
  if (
    !data.title ||
    !data.description ||
    !data.date
  ) {
    throw new Error(`Blog post ${path} is missing required frontmatter`)
  }

  return {
    slug: slugFromPath(path),
    title: data.title,
    description: data.description,
    cover: data.cover,
    coverAlt: data.coverAlt,
    date: data.date,
    author: data.author ?? "The Scopy team",
    tags: data.tags ? data.tags.split(",").map((t) => t.trim()) : [],
    readingMinutes: readingMinutes(body),
    html: marked.parse(body) as string,
    markdown: body.trim(),
  }
}

const posts: BlogPost[] = Object.entries(rawPosts)
  .map(([path, raw]) => buildPost(path, raw))
  .sort((a, b) => (a.date < b.date ? 1 : -1))

export function getAllPosts(): BlogPost[] {
  return posts
}

export function getPost(slug: string): BlogPost | undefined {
  return posts.find((p) => p.slug === slug)
}

export function formatPostDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  })
}
