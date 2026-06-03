export type ParsedDiffLine = {
  kind: "context" | "added" | "removed"
  content: string
  oldLine?: number
  newLine?: number
}

export type ParsedDiffHunk = {
  header: string
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: ParsedDiffLine[]
  touchedNewLines: number[]
  anchorNewLines: number[]
}

export type ParsedDiffFile = {
  oldPath?: string
  newPath?: string
  status: "added" | "modified" | "deleted" | "renamed" | "unknown"
  hunks: ParsedDiffHunk[]
}

const hunkPattern = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

const normalizePath = (value: string) =>
  value.replace(/^"|"$/g, "").replace(/^[ab]\//, "")

const inferStatus = (file: ParsedDiffFile): ParsedDiffFile["status"] => {
  if (file.newPath === "/dev/null") return "deleted"
  if (file.oldPath === "/dev/null") return "added"
  if (file.oldPath && file.newPath && file.oldPath !== file.newPath) return "renamed"
  return "modified"
}

export const parseUnifiedDiff = (diff: string): ParsedDiffFile[] => {
  const files: ParsedDiffFile[] = []
  let currentFile: ParsedDiffFile | undefined
  let currentHunk: ParsedDiffHunk | undefined
  let oldLine = 0
  let newLine = 0

  for (const rawLine of diff.split(/\r?\n/)) {
    if (rawLine.startsWith("diff --git ")) {
      currentFile = { status: "unknown", hunks: [] }
      files.push(currentFile)
      currentHunk = undefined
      continue
    }
    if (!currentFile) continue
    if (rawLine.startsWith("--- ")) {
      currentFile.oldPath = normalizePath(rawLine.slice(4).trim())
      currentFile.status = inferStatus(currentFile)
      continue
    }
    if (rawLine.startsWith("+++ ")) {
      currentFile.newPath = normalizePath(rawLine.slice(4).trim())
      currentFile.status = inferStatus(currentFile)
      continue
    }
    const hunkMatch = rawLine.match(hunkPattern)
    if (hunkMatch) {
      oldLine = Number(hunkMatch[1])
      newLine = Number(hunkMatch[3])
      currentHunk = {
        header: rawLine,
        oldStart: oldLine,
        oldLines: Number(hunkMatch[2] ?? "1"),
        newStart: newLine,
        newLines: Number(hunkMatch[4] ?? "1"),
        lines: [],
        touchedNewLines: [],
        anchorNewLines: [],
      }
      currentFile.hunks.push(currentHunk)
      continue
    }
    if (!currentHunk) continue
    const marker = rawLine[0]
    const content = rawLine.slice(1)
    if (marker === "+") {
      currentHunk.lines.push({ kind: "added", content, newLine })
      currentHunk.touchedNewLines.push(newLine)
      currentHunk.anchorNewLines.push(newLine)
      newLine += 1
    } else if (marker === "-") {
      currentHunk.lines.push({ kind: "removed", content, oldLine })
      oldLine += 1
    } else if (marker === " " || rawLine === "") {
      currentHunk.lines.push({ kind: "context", content, oldLine, newLine })
      currentHunk.anchorNewLines.push(newLine)
      oldLine += 1
      newLine += 1
    }
  }

  return files.filter((file) => file.hunks.length > 0)
}
