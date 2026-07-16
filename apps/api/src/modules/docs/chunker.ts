const TARGET_MIN_TOKENS = 200
const TARGET_MAX_TOKENS = 1500

const approxTokens = (text: string) => Math.ceil(text.length / 4)

export type DocChunkInput = {
  ord: number
  heading: string | null
  contentMd: string
  approxTokens: number
}

type Section = {
  headingPath: string[]
  lines: string[]
}

const splitByHeadings = (markdown: string): Section[] => {
  const sections: Section[] = [{ headingPath: [], lines: [] }]
  const path: { level: number; title: string }[] = []
  let inCodeFence = false

  for (const line of markdown.split("\n")) {
    if (/^(```|~~~)/.test(line.trim())) inCodeFence = !inCodeFence
    const match = inCodeFence ? null : line.match(/^(#{1,3})\s+(.*)$/)
    if (!match?.[1] || !match[2]) {
      sections[sections.length - 1]!.lines.push(line)
      continue
    }
    const level = match[1].length
    while (path.length > 0 && path[path.length - 1]!.level >= level) {
      path.pop()
    }
    path.push({ level, title: match[2].trim() })
    sections.push({
      headingPath: path.map((entry) => entry.title),
      lines: [line],
    })
  }

  return sections.filter(
    (section) => section.lines.join("\n").trim().length > 0
  )
}

/** Hard fallback: split a blank-line-free blob on line boundaries. */
const splitByLines = (text: string): string[] => {
  if (approxTokens(text) <= TARGET_MAX_TOKENS) return [text]
  const lines = text.split("\n")
  const parts: string[] = []
  let current = ""
  for (const line of lines) {
    const candidate = current ? `${current}\n${line}` : line
    if (current && approxTokens(candidate) > TARGET_MAX_TOKENS) {
      parts.push(current)
      current = line
    } else {
      current = candidate
    }
  }
  if (current) parts.push(current)
  return parts
}

/** Split an oversized section on paragraph boundaries, keeping code fences intact. */
const splitOversized = (text: string): string[] => {
  if (approxTokens(text) <= TARGET_MAX_TOKENS) return [text]
  const paragraphs = text.split(/\n\n+/)
  const parts: string[] = []
  let current = ""
  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph
    if (current && approxTokens(candidate) > TARGET_MAX_TOKENS) {
      parts.push(current)
      current = paragraph
    } else {
      current = candidate
    }
  }
  if (current) parts.push(current)
  return parts.flatMap(splitByLines)
}

/**
 * Split page markdown into retrieval chunks: one chunk per h1-h3 section,
 * merging undersized neighbors that share a parent heading and splitting
 * oversized sections on paragraph boundaries.
 */
export const chunkMarkdown = (markdown: string): DocChunkInput[] => {
  const sections = splitByHeadings(markdown)

  const merged: { headingPath: string[]; text: string }[] = []
  for (const section of sections) {
    const text = section.lines.join("\n").trim()
    const previous = merged[merged.length - 1]
    if (
      previous &&
      approxTokens(previous.text) < TARGET_MIN_TOKENS &&
      approxTokens(`${previous.text}\n\n${text}`) <= TARGET_MAX_TOKENS
    ) {
      previous.text = `${previous.text}\n\n${text}`
      const shared: string[] = []
      for (
        let index = 0;
        index <
        Math.min(previous.headingPath.length, section.headingPath.length);
        index += 1
      ) {
        if (previous.headingPath[index] !== section.headingPath[index]) break
        shared.push(previous.headingPath[index]!)
      }
      previous.headingPath = shared.length
        ? shared
        : previous.headingPath.slice(0, 1)
      continue
    }
    merged.push({ headingPath: section.headingPath, text })
  }

  const chunks: DocChunkInput[] = []
  for (const section of merged) {
    for (const part of splitOversized(section.text)) {
      const trimmed = part.trim()
      if (!trimmed) continue
      chunks.push({
        ord: chunks.length,
        heading: section.headingPath.length
          ? section.headingPath.join(" > ")
          : null,
        contentMd: trimmed,
        approxTokens: approxTokens(trimmed),
      })
    }
  }
  return chunks
}
