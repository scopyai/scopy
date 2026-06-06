import { readRepositoryFile, type parseUnifiedDiff } from "tools"
import type { ReviewFinding, ReviewReport } from "./prompt"

type ParsedDiffFiles = ReturnType<typeof parseUnifiedDiff>

export type FindingEvidenceValidation = {
  findingIndex: number
  title: string
  file: string
  startLine: number
  endLine: number
  valid: boolean
  reasons: string[]
  normalized?: {
    file: string
    startLine: number
    endLine: number
  }
  selectedSource?: string
  changedLineOverlap?: number[]
}

export type ReviewReportEvidenceValidation = {
  valid: boolean
  findings: FindingEvidenceValidation[]
}

const MAX_EVIDENCE_LINES = 30

const diffPath = (file: ParsedDiffFiles[number]) =>
  file.newPath && file.newPath !== "/dev/null" ? file.newPath : file.oldPath

const changedLinesByFile = (diffFiles: ParsedDiffFiles) => {
  const result = new Map<string, Set<number>>()
  for (const diffFile of diffFiles) {
    const file = diffPath(diffFile)
    if (!file || file === "/dev/null" || diffFile.status === "deleted") {
      continue
    }
    const lines = new Set<number>()
    for (const hunk of diffFile.hunks) {
      for (const line of hunk.touchedNewLines) {
        lines.add(line)
      }
    }
    result.set(file, lines)
  }
  return result
}

const lineRange = (startLine: number, endLine: number) =>
  Array.from(
    { length: Math.max(0, endLine - startLine + 1) },
    (_, index) => startLine + index,
  )

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
  const changedLines = changedLinesByFile(diffFiles)
  const changedFileLines = changedLines.get(finding.file)
  const reasons: string[] = []
  const rangeLength = finding.endLine - finding.startLine + 1

  if (!changedFileLines) {
    reasons.push("File is not a changed head-side file in this pull request.")
  }
  if (finding.endLine < finding.startLine) {
    reasons.push("endLine must be greater than or equal to startLine.")
  }
  if (rangeLength > MAX_EVIDENCE_LINES) {
    reasons.push(
      `Evidence range is too large; use at most ${MAX_EVIDENCE_LINES} lines.`,
    )
  }

  let selectedSource: string | undefined
  try {
    const selected = await readRepositoryFile({
      repository,
      file: finding.file,
      startLine: finding.startLine,
      maxLines: Math.max(1, Math.min(MAX_EVIDENCE_LINES, rangeLength)),
    })
    if (finding.endLine > selected.totalLines) {
      reasons.push(
        `endLine ${finding.endLine} exceeds file length ${selected.totalLines}.`,
      )
    }
    if (selected.endLine < finding.endLine) {
      reasons.push(
        `Evidence range ${finding.startLine}-${finding.endLine} could not be fully read.`,
      )
    }
    selectedSource = selected.content
  } catch (error) {
    reasons.push(error instanceof Error ? error.message : "Could not read file.")
  }

  const overlap =
    changedFileLines && reasons.length === 0
      ? lineRange(finding.startLine, finding.endLine).filter((line) =>
          changedFileLines.has(line),
        )
      : []
  if (changedFileLines && overlap.length === 0) {
    reasons.push("Evidence range does not overlap any added or modified line.")
  }

  const valid = reasons.length === 0
  return {
    findingIndex,
    title: finding.title,
    file: finding.file,
    startLine: finding.startLine,
    endLine: finding.endLine,
    valid,
    reasons,
    normalized: valid
      ? {
          file: finding.file,
          startLine: finding.startLine,
          endLine: finding.endLine,
        }
      : undefined,
    selectedSource,
    changedLineOverlap: overlap,
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
      validateFindingEvidence({ repository, diffFiles, finding, findingIndex }),
    ),
  )
  return {
    valid: findings.every((finding) => finding.valid),
    findings,
  }
}

export const filterReportToValidEvidence = (
  report: ReviewReport,
  validation: ReviewReportEvidenceValidation,
): ReviewReport => {
  const validIndexes = new Set(
    validation.findings
      .filter((finding) => finding.valid)
      .map((finding) => finding.findingIndex),
  )
  const findings = report.findings.filter((_, index) => validIndexes.has(index))
  if (report.findings.length > 0 && findings.length === 0) {
    return {
      summary:
        "No candidate findings had valid changed-line ranges after evidence validation.",
      mergeSafetyScore: 5,
      mergeSafetyReason:
        "All candidate findings were dropped because their file/startLine/endLine evidence ranges were invalid.",
      findings,
    }
  }

  return {
    ...report,
    findings,
  }
}
