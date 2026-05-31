export type PullRequestFile = {
  filename: string
  status: string
  additions: number
  deletions: number
  changes: number
  patch?: string
}

export const MAX_REVIEW_FILES = 300
export const MAX_REVIEW_DIFF_CHARACTERS = 100_000

const matchesPattern = (path: string, pattern: string) => {
  const expression = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\0")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\0/g, ".*")

  return new RegExp(`^${expression}$`).test(path)
}

export const filterPullRequestFiles = (
  files: PullRequestFile[],
  includePatterns: string[],
  excludePatterns: string[]
) =>
  files.filter(
    (file) =>
      (includePatterns.length === 0 ||
        includePatterns.some((pattern) =>
          matchesPattern(file.filename, pattern)
        )) &&
      !excludePatterns.some((pattern) => matchesPattern(file.filename, pattern))
  )

export const serializePullRequestFiles = (files: PullRequestFile[]) =>
  files
    .map((file) =>
      [
        `### ${file.filename}`,
        `Status: ${file.status}`,
        `Changes: +${file.additions} -${file.deletions} (${file.changes} total)`,
        file.patch ? `Patch:\n${file.patch}` : "Patch: unavailable",
      ].join("\n")
    )
    .join("\n\n")

export const getDiffSkipReason = (
  fileCount: number,
  characterCount: number
) => {
  if (fileCount > MAX_REVIEW_FILES) {
    return `The pull request changes ${fileCount} files, which exceeds the ${MAX_REVIEW_FILES}-file review limit.`
  }

  if (characterCount > MAX_REVIEW_DIFF_CHARACTERS) {
    return `The pull request diff contains ${characterCount.toLocaleString()} characters, which exceeds the ${MAX_REVIEW_DIFF_CHARACTERS.toLocaleString()}-character review limit.`
  }

  return null
}
