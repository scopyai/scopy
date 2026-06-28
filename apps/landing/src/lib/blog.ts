import { marked } from "marked"

export type BlogPost = {
  slug: string
  title: string
  description: string
  date: string
  author: string
  tags: string[]
  readingMinutes: number
  html: string
}

type Frontmatter = {
  title: string
  description: string
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
  if (!data.title || !data.description || !data.date) {
    throw new Error(`Blog post ${path} is missing required frontmatter`)
  }

  return {
    slug: slugFromPath(path),
    title: data.title,
    description: data.description,
    date: data.date,
    author: data.author ?? "The Scopy team",
    tags: data.tags ? data.tags.split(",").map((t) => t.trim()) : [],
    readingMinutes: readingMinutes(body),
    html: marked.parse(body) as string,
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
