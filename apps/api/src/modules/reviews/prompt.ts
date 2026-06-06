import { z } from "zod"
import type { DiffContextResult } from "tools"

export const reviewFindingSchema = z.object({
  severity: z.enum(["critical", "high", "medium", "low"]),
  file: z.string().min(1),
  line: z.number().int().positive(),
  title: z.string().min(1),
  body: z.string().min(1),
  confidence: z.number().min(0).max(1),
})

export const reviewReportSchema = z.object({
  summary: z.string().min(1),
  mergeSafetyScore: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
  ]),
  mergeSafetyReason: z.string().min(1),
  findings: z.array(reviewFindingSchema),
})

export type ReviewReport = z.infer<typeof reviewReportSchema>

export const renderAffectedSymbols = (context: DiffContextResult) => {
  const lines = [
    "# Changed Symbol Index",
    "",
    `Files: ${context.files.length}`,
    `Affected symbols: ${context.files.reduce((total, file) => total + file.affectedSymbols.length, 0)}`,
    "",
  ]

  if (context.diagnostics.length > 0) {
    lines.push("Diagnostics:")
    for (const diagnostic of context.diagnostics) {
      const location = diagnostic.file
        ? `${diagnostic.file}${diagnostic.line ? `:${diagnostic.line}` : ""}`
        : "repository"
      lines.push(`- ${diagnostic.kind} ${location}: ${diagnostic.message}`)
    }
    lines.push("")
  }

  for (const file of context.files) {
    lines.push(`## ${file.file}`)
    lines.push(`- status: ${file.status}`)
    if (file.language) lines.push(`- language: ${file.language}`)

    if (file.affectedSymbols.length > 0) {
      lines.push("- symbols:")
      for (const symbol of file.affectedSymbols) {
        lines.push(
          `  - ${symbol.kind} ${symbol.name} ${symbol.startLine}-${symbol.endLine}; touched lines: ${symbol.touchedLines.join(", ")}`,
        )
      }
    } else {
      lines.push("- symbols: none detected")
    }

    if (file.topLevelChangedLines.length > 0) {
      lines.push(
        `- top-level changed lines: ${file.topLevelChangedLines.join(", ")}`,
      )
    }
    lines.push("")
  }

  return lines.join("\n").trim()
}

export const buildReviewAgentPrompt = ({
  title,
  body,
  baseRef,
  headRef,
  diff,
  affectedSymbols,
}: {
  title: string
  body: string | null
  baseRef: string
  headRef: string
  diff: string
  affectedSymbols: string
}) => `Review this pull request for bugs, regressions, security issues, and production risks.

Focus on changed behavior and directly related context. Do not report style-only feedback.
Every finding must point to a changed file and a concrete line that the author can act on.
If there are no actionable issues, return an empty findings array.

Required review workflow:
1. Triage the full diff first. Identify changed behavior, affected symbols, and plausible failure modes before calling tools.
2. Use the changed symbol index to choose focused follow-up tool calls.
3. If a possible finding depends on implementation details not visible in the diff, inspect the relevant symbol definition before reporting it.
4. If a possible finding depends on how other code calls a changed symbol, inspect callers before reporting it.
5. If related behavior is not discoverable from symbol names, use semantic code search with a short behavior phrase plus relevant symbol or file names. Do not paste code into search queries.
6. Use file reads only for specific line ranges or files without usable symbol context.
7. Before returning the report, discard any finding that is not directly supported by the diff or by tool results you inspected.

Merge safety score:
1 = extremely unsafe to merge; critical issues can cause real production damage.
2 = unsafe to merge; serious issues should block merge.
3 = risky; merge only after review or fixes.
4 = mostly safe; minor concerns or low-risk follow-up.
5 = safe to merge; no actionable issues found.

Pull request title: ${title}
Pull request description: ${body ?? "(none)"}
Base branch: ${baseRef}
Head branch: ${headRef}

Changed files:
${diff}

Changed symbol index:
${affectedSymbols}`

const scoreLabel = (score: ReviewReport["mergeSafetyScore"]) => {
  if (score === 1) return "1/5 - extremely unsafe"
  if (score === 2) return "2/5 - unsafe"
  if (score === 3) return "3/5 - risky"
  if (score === 4) return "4/5 - mostly safe"
  return "5/5 - safe"
}

export const renderReviewReport = (report: ReviewReport) => {
  const sections = [
    "## Review summary",
    "",
    report.summary,
    "",
    "## Merge safety",
    "",
    `**${scoreLabel(report.mergeSafetyScore)}**`,
    "",
    report.mergeSafetyReason,
    "",
    "## Findings",
    "",
  ]

  if (report.findings.length === 0) {
    sections.push("No actionable findings.")
  } else {
    for (const finding of report.findings) {
      sections.push(
        `### [${finding.severity}] ${finding.title}`,
        "",
        `Location: \`${finding.file}:${finding.line}\``,
        `Confidence: ${Math.round(finding.confidence * 100)}%`,
        "",
        finding.body,
        "",
      )
    }
  }

  return sections.join("\n").trim()
}
