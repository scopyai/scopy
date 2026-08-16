export type ReviewIndexDecision = {
  index: boolean
  reason?: "hard-ignore" | "soft-ignore"
}

const hardIgnoredPathParts = new Set([
  ".codex",
  ".git",
  ".github",
  ".idea",
  ".vscode",
  "__generated__",
  "__snapshots__",
  "coverage",
  "dist",
  "generated",
  "node_modules",
  "snapshots",
  "vendor",
])

const softIgnoredPathParts = new Set([
  ".agents",
  "__fixtures__",
  "examples",
  "fixtures",
  "samples",
])

const isDocumentationPath = (file: string) => {
  const parts = file.split(/[\\/]/)
  const docsIndex = parts.indexOf("docs")
  if (docsIndex === -1) return false

  const sourceRootIndex = parts.findIndex((part) =>
    ["app", "lib", "src"].includes(part)
  )
  return sourceRootIndex === -1 || docsIndex < sourceRootIndex
}

const hardIgnoredFilePatterns = [
  /(^|\/)package-lock\.json$/,
  /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)yarn\.lock$/,
  /(^|\/)bun\.lockb?$/,
  /(^|\/)Cargo\.lock$/,
  /(^|\/)go\.sum$/,
  /(^|\/)composer\.lock$/,
  /(^|\/)Gemfile\.lock$/,
  /(^|\/)poetry\.lock$/,
  /(^|\/)uv\.lock$/,
  /(^|\/)drizzle\/meta\//,
  /\.d\.ts$/,
  /\.generated\.[^.]+$/,
  /\.gen\.[^.]+$/,
  /\.min\.[^.]+$/,
  /\.snap$/,
  /snapshot/i,
]

const hasPart = (file: string, parts: Set<string>) =>
  file.split(/[\\/]/).some((part) => parts.has(part))

export const reviewIndexDecision = (
  file: string,
  changedFiles = new Set<string>()
): ReviewIndexDecision => {
  if (
    hasPart(file, hardIgnoredPathParts) ||
    hardIgnoredFilePatterns.some((pattern) => pattern.test(file))
  ) {
    return { index: false, reason: "hard-ignore" }
  }

  if (
    (hasPart(file, softIgnoredPathParts) || isDocumentationPath(file)) &&
    !changedFiles.has(file)
  ) {
    return { index: false, reason: "soft-ignore" }
  }

  return { index: true }
}
