export type ReviewIndexDecision = {
  index: boolean
  reason?: "hard-ignore" | "soft-ignore"
}

const hardIgnoredPathParts = new Set([
  ".agents",
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
  "__fixtures__",
  "docs",
  "examples",
  "fixtures",
  "samples",
])

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
  changedFiles = new Set<string>(),
): ReviewIndexDecision => {
  if (
    hasPart(file, hardIgnoredPathParts) ||
    hardIgnoredFilePatterns.some((pattern) => pattern.test(file))
  ) {
    return { index: false, reason: "hard-ignore" }
  }

  if (hasPart(file, softIgnoredPathParts) && !changedFiles.has(file)) {
    return { index: false, reason: "soft-ignore" }
  }

  return { index: true }
}

export const shouldReviewIndexFile = (
  file: string,
  changedFiles = new Set<string>(),
) => reviewIndexDecision(file, changedFiles).index
