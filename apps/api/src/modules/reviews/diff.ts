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
    .replace(/\*\*\//g, "__GLOBSTAR_DIRECTORY__")
    .replace(/\*\*/g, "__GLOBSTAR__")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/__GLOBSTAR_DIRECTORY__/g, "(?:.*/)?")
    .replace(/__GLOBSTAR__/g, ".*")

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

export const serializePullRequestFilesAsUnifiedDiff = (
  files: PullRequestFile[]
) =>
  files
    .filter((file) => file.patch)
    .map((file) =>
      [
        `diff --git a/${file.filename} b/${file.filename}`,
        `--- ${file.status === "added" ? "/dev/null" : `a/${file.filename}`}`,
        `+++ ${file.status === "removed" ? "/dev/null" : `b/${file.filename}`}`,
        file.patch,
      ].join("\n")
    )
    .join("\n")

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
