import { readRepositoryFile, type parseUnifiedDiff } from "tools"
import type { ReviewFinding, ReviewReport } from "./prompt"

type ParsedDiffFiles = ReturnType<typeof parseUnifiedDiff>

export type FindingEvidenceValidation = {
  findingIndex: number
  title: string
  file: string
  startLine: number
  endLine: number
  status: "valid" | "repairable" | "invalid"
  valid: boolean
  reasons: string[]
  normalized?: {
    file: string
    startLine: number
    endLine: number
  }
  selectedSource?: string
  changedLineOverlap?: number[]
  anchorLineOverlap?: number[]
}

export type ReviewReportEvidenceValidation = {
  valid: boolean
  findings: FindingEvidenceValidation[]
}

const PREFERRED_EVIDENCE_LINES = 30
const PERMISSIVE_EVIDENCE_LINES = 60
const MAX_SOURCE_READ_LINES = 120

const diffPath = (file: ParsedDiffFiles[number]) =>
  file.newPath && file.newPath !== "/dev/null" ? file.newPath : file.oldPath

export const buildFindingAnchorCheck = (diffFiles: ParsedDiffFiles) => {
  const diffLines = diffLinesByFile(diffFiles)
  return (finding: {
    file: string
    startLine: number
    endLine: number
  }): boolean => {
    const fileDiffLines = diffLines.get(finding.file)
    if (!fileDiffLines) return false
    for (let line = finding.startLine; line <= finding.endLine; line += 1) {
      if (fileDiffLines.anchors.has(line)) return true
    }
    return false
  }
}

const diffLinesByFile = (diffFiles: ParsedDiffFiles) => {
  const result = new Map<
    string,
    { changed: Set<number>; anchors: Set<number> }
  >()
  for (const diffFile of diffFiles) {
    const file = diffPath(diffFile)
    if (!file || file === "/dev/null" || diffFile.status === "deleted") {
      continue
    }
    const changed = new Set<number>()
    const anchors = new Set<number>()
    for (const hunk of diffFile.hunks) {
      for (const line of hunk.touchedNewLines) {
        changed.add(line)
      }
      for (const line of hunk.anchorNewLines) {
        anchors.add(line)
      }
    }
    result.set(file, { changed, anchors })
  }
  return result
}

const hunkAnchorsByFile = (diffFiles: ParsedDiffFiles) => {
  const result = new Map<string, number[][]>()
  for (const diffFile of diffFiles) {
    const file = diffPath(diffFile)
    if (!file || file === "/dev/null" || diffFile.status === "deleted") {
      continue
    }
    result.set(
      file,
      diffFile.hunks
        .map((hunk) => sortedNumbers(hunk.anchorNewLines))
        .filter((lines) => lines.length > 0)
    )
  }
  return result
}

const lineRange = (startLine: number, endLine: number) =>
  Array.from(
    { length: Math.max(0, endLine - startLine + 1) },
    (_, index) => startLine + index
  )

const sortedNumbers = (values: Iterable<number>) =>
  [...values].sort((first, second) => first - second)

const clampEvidenceWindow = ({
  lines,
  totalLines,
  maxLines,
}: {
  lines: number[]
  totalLines: number
  maxLines: number
}) => {
  if (lines.length === 0) return null
  const minLine = Math.max(1, Math.min(...lines))
  const maxLine = Math.min(totalLines, Math.max(...lines))
  if (maxLine - minLine + 1 <= maxLines) {
    return { startLine: minLine, endLine: maxLine }
  }

  const center = lines[Math.floor(lines.length / 2)] ?? minLine
  const before = Math.floor((maxLines - 1) / 2)
  const startLine = Math.max(
    1,
    Math.min(center - before, totalLines - maxLines + 1)
  )
  return {
    startLine,
    endLine: Math.min(totalLines, startLine + maxLines - 1),
  }
}

export const validateFindingEvidence = async ({
  repository,
  diffFiles,
  finding,
  findingIndex,
}: {
  repository: string
  diffFiles: ParsedDiffFiles
  finding: ReviewFinding
  findingIndex: number
}): Promise<FindingEvidenceValidation> => {
  const diffLines = diffLinesByFile(diffFiles)
  const fileDiffLines = diffLines.get(finding.file)
  const reasons: string[] = []
  const repairs: string[] = []
  const hardReasons: string[] = []
  const rangeLength = finding.endLine - finding.startLine + 1
  let normalizedStartLine = finding.startLine
  let normalizedEndLine = finding.endLine
  let totalLines: number | undefined

  if (!fileDiffLines) {
    hardReasons.push(
      "File is not a changed head-side file in this pull request."
    )
  }
  if (finding.startLine < 1) {
    hardReasons.push("startLine must be positive.")
  }
  if (finding.endLine < finding.startLine) {
    hardReasons.push("endLine must be greater than or equal to startLine.")
  }
  if (rangeLength > PREFERRED_EVIDENCE_LINES) {
    reasons.push(
      `Evidence range is wider than the preferred ${PREFERRED_EVIDENCE_LINES} lines.`
    )
  }

  let selectedSource: string | undefined
  if (hardReasons.length === 0) {
    try {
      const selected = await readRepositoryFile({
        repository,
        file: finding.file,
        startLine: finding.startLine,
        maxLines: Math.max(1, Math.min(MAX_SOURCE_READ_LINES, rangeLength)),
      })
      totalLines = selected.totalLines
      if (finding.startLine > selected.totalLines) {
        hardReasons.push(
          `startLine ${finding.startLine} exceeds file length ${selected.totalLines}.`
        )
      }
      if (finding.endLine > selected.totalLines) {
        reasons.push(
          `endLine ${finding.endLine} exceeds file length ${selected.totalLines}; clamped to file end.`
        )
        normalizedEndLine = selected.totalLines
        repairs.push("Clamped endLine to the file length.")
      }
      if (
        rangeLength > MAX_SOURCE_READ_LINES &&
        selected.endLine < finding.endLine
      ) {
        reasons.push(
          `Evidence range ${finding.startLine}-${finding.endLine} is too large to read fully in validation.`
        )
      }
      selectedSource = selected.content
    } catch (error) {
      hardReasons.push(
        error instanceof Error ? error.message : "Could not read file."
      )
    }
  }

  const changedOverlap =
    fileDiffLines && finding.endLine >= finding.startLine
      ? lineRange(finding.startLine, finding.endLine).filter((line) =>
          fileDiffLines.changed.has(line)
        )
      : []
  const anchorOverlap =
    fileDiffLines && finding.endLine >= finding.startLine
      ? lineRange(finding.startLine, finding.endLine).filter((line) =>
          fileDiffLines.anchors.has(line)
        )
      : []

  if (fileDiffLines && anchorOverlap.length === 0) {
    reasons.push("Evidence range does not overlap any commentable diff line.")
  }

  if (
    hardReasons.length === 0 &&
    totalLines &&
    rangeLength > PERMISSIVE_EVIDENCE_LINES
  ) {
    const narrowed = clampEvidenceWindow({
      lines:
        anchorOverlap.length > 0
          ? sortedNumbers(anchorOverlap)
          : sortedNumbers(fileDiffLines?.anchors ?? []),
      totalLines,
      maxLines: PREFERRED_EVIDENCE_LINES,
    })
    if (narrowed) {
      normalizedStartLine = narrowed.startLine
      normalizedEndLine = narrowed.endLine
      repairs.push(
        `Narrowed broad evidence range to ${normalizedStartLine}-${normalizedEndLine}.`
      )
    }
  }

  if (
    hardReasons.length === 0 &&
    totalLines &&
    fileDiffLines &&
    anchorOverlap.length === 0
  ) {
    const anchors = sortedNumbers(fileDiffLines.anchors)
    const midpoint = Math.floor((finding.startLine + finding.endLine) / 2)
    const nearest = anchors
      .map((line) => ({ line, distance: Math.abs(line - midpoint) }))
      .sort((first, second) => first.distance - second.distance)[0]
    if (nearest && nearest.distance <= PREFERRED_EVIDENCE_LINES) {
      const narrowed = clampEvidenceWindow({
        lines: [nearest.line],
        totalLines,
        maxLines: Math.min(PREFERRED_EVIDENCE_LINES, Math.max(1, rangeLength)),
      })
      if (narrowed) {
        normalizedStartLine = narrowed.startLine
        normalizedEndLine = narrowed.endLine
        repairs.push(
          `Moved evidence anchor to nearby diff context ${normalizedStartLine}-${normalizedEndLine}.`
        )
      }
    }
  }
  if (hardReasons.length === 0 && fileDiffLines) {
    const fileHunkAnchors = hunkAnchorsByFile(diffFiles).get(finding.file) ?? []
    let snapped: { startLine: number; endLine: number } | null = null
    let snappedAnchorCount = 0
    for (const anchorLines of fileHunkAnchors) {
      const inRange = anchorLines.filter(
        (line) => line >= normalizedStartLine && line <= normalizedEndLine
      )
      if (inRange.length > snappedAnchorCount) {
        snappedAnchorCount = inRange.length
        snapped = {
          startLine: inRange[0]!,
          endLine: inRange[inRange.length - 1]!,
        }
      }
    }
    if (!snapped) {
      const anchors = sortedNumbers(fileDiffLines.anchors)
      const midpoint = Math.floor((normalizedStartLine + normalizedEndLine) / 2)
      const nearest = anchors
        .map((line) => ({ line, distance: Math.abs(line - midpoint) }))
        .sort((first, second) => first.distance - second.distance)[0]
      if (nearest && nearest.distance <= PERMISSIVE_EVIDENCE_LINES) {
        snapped = { startLine: nearest.line, endLine: nearest.line }
      }
    }
    if (!snapped) {
      hardReasons.push(
        "Evidence range cannot be snapped to commentable diff lines."
      )
    } else if (
      snapped.startLine !== normalizedStartLine ||
      snapped.endLine !== normalizedEndLine
    ) {
      normalizedStartLine = snapped.startLine
      normalizedEndLine = snapped.endLine
      repairs.push(
        `Snapped evidence range to commentable diff lines ${snapped.startLine}-${snapped.endLine}.`
      )
    }
  }

  if (
    hardReasons.length === 0 &&
    normalizedEndLine - normalizedStartLine + 1 > PERMISSIVE_EVIDENCE_LINES
  ) {
    hardReasons.push(
      `Evidence range remains wider than ${PERMISSIVE_EVIDENCE_LINES} lines after repair.`
    )
  }

  if (hardReasons.length === 0 && totalLines) {
    try {
      const selected = await readRepositoryFile({
        repository,
        file: finding.file,
        startLine: normalizedStartLine,
        maxLines: Math.max(1, normalizedEndLine - normalizedStartLine + 1),
      })
      selectedSource = selected.content
    } catch {}
  }

  const status =
    hardReasons.length > 0
      ? "invalid"
      : repairs.length > 0
        ? "repairable"
        : "valid"
  const valid = status !== "invalid"
  return {
    findingIndex,
    title: finding.title,
    file: finding.file,
    startLine: finding.startLine,
    endLine: finding.endLine,
    status,
    valid,
    reasons: [...hardReasons, ...reasons, ...repairs],
    normalized: valid
      ? {
          file: finding.file,
          startLine: normalizedStartLine,
          endLine: normalizedEndLine,
        }
      : undefined,
    selectedSource,
    changedLineOverlap: changedOverlap,
    anchorLineOverlap: anchorOverlap,
  }
}

export const validateReviewReportEvidence = async ({
  repository,
  diffFiles,
  report,
}: {
  repository: string
  diffFiles: ParsedDiffFiles
  report: ReviewReport
}): Promise<ReviewReportEvidenceValidation> => {
  const findings = await Promise.all(
    report.findings.map((finding, findingIndex) =>
      validateFindingEvidence({ repository, diffFiles, finding, findingIndex })
    )
  )
  return {
    valid: findings.every((finding) => finding.valid),
    findings,
  }
}
