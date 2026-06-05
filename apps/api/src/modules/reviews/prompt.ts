import { z } from "zod"

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

export const buildReviewAgentPrompt = ({
  title,
  body,
  baseRef,
  headRef,
  diff,
  diffContext,
  semanticContext,
}: {
  title: string
  body: string | null
  baseRef: string
  headRef: string
  diff: string
  diffContext: string
  semanticContext?: string | null
}) => `Review this pull request for bugs, regressions, security issues, and production risks.

Focus on changed behavior and directly related context. Do not report style-only feedback.
Use the available tools when you need more file context, symbol definitions, callers, or semantic code search.
Every finding must point to a changed file and a concrete line that the author can act on.
If there are no actionable issues, return an empty findings array.

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

Affected function/class context:
${diffContext}

Initial semantic context:
${semanticContext ?? "(semantic context unavailable)"}`

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
