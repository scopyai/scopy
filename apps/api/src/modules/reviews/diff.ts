export type PullRequestFile = {
  filename: string
  status: string
  additions: number
  deletions: number
  changes: number
  patch?: string
  omittedReason?: string
}

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
      !getPullRequestFileOmittedReason(file, includePatterns, excludePatterns)
  )

export const getPullRequestFileOmittedReason = (
  file: PullRequestFile,
  includePatterns: string[],
  excludePatterns: string[]
) => {
  if (
    includePatterns.length > 0 &&
    !includePatterns.some((pattern) => matchesPattern(file.filename, pattern))
  ) {
    return `content omitted because the file does not match configured include patterns: ${includePatterns.join(", ")}`
  }

  const excludePattern = excludePatterns.find((pattern) =>
    matchesPattern(file.filename, pattern)
  )
  if (excludePattern) {
    return `content omitted by configured exclude pattern: ${excludePattern}`
  }

  return null
}

export const annotatePullRequestFilesForReview = (
  files: PullRequestFile[],
  includePatterns: string[],
  excludePatterns: string[]
): PullRequestFile[] =>
  files.map((file) => {
    const omittedReason = getPullRequestFileOmittedReason(
      file,
      includePatterns,
      excludePatterns
    )
    return omittedReason
      ? { ...file, patch: undefined, omittedReason }
      : { ...file, omittedReason: undefined }
  })

export const countPullRequestChangedLines = (files: PullRequestFile[]) =>
  files.reduce((total, file) => total + file.additions + file.deletions, 0)

export const batchNaturalLanguageLinterFiles = (
  files: PullRequestFile[],
  targetSize = 4
) => {
  const batches: PullRequestFile[][] = []
  for (let index = 0; index < files.length; index += targetSize) {
    batches.push(files.slice(index, index + targetSize))
  }
  const last = batches.at(-1)
  const previous = batches.at(-2)
  if (last && previous && last.length < 3) {
    previous.push(...last)
    batches.pop()
  }
  return batches
}

export const serializePullRequestFiles = (files: PullRequestFile[]) =>
  files
    .map((file) =>
      [
        `### ${file.filename}`,
        `Status: ${file.status}`,
        `Changes: +${file.additions} -${file.deletions} (${file.changes} total)`,
        file.omittedReason
          ? `Patch: ${file.omittedReason}`
          : file.patch
            ? `Patch:\n${file.patch}`
            : "Patch: unavailable",
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
  changedLineCount: number,
  maxChangedLines: number
) => {
  if (changedLineCount > maxChangedLines) {
    return `The pull request contains ${changedLineCount.toLocaleString()} reviewable changed lines, which exceeds the configured ${maxChangedLines.toLocaleString()}-line review limit.`
  }

  return null
}
