import { z } from "zod"
import type { CodeChunk, DiffContextResult, RepositoryCodeIndex } from "tools"
import type { PullRequestFile } from "./diff"

export const reviewFindingSchema = z.object({
  severity: z.enum(["critical", "high", "medium", "low"]),
  file: z.string().min(1),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  title: z.string().min(1),
  body: z.string().min(1),
  confidence: z.number().min(0).max(1),
})

export type ReviewFinding = z.infer<typeof reviewFindingSchema>

export const scoutCandidateSchema = reviewFindingSchema.extend({
  sourceFile: z.string().min(1),
  evidence: z.string().min(1),
  uncertainty: z.string().min(1),
})

export type ScoutCandidate = z.infer<typeof scoutCandidateSchema>

export const fileScoutOutputSchema = z.object({
  file: z.string().min(1),
  summary: z.string().min(1),
  inspectedSymbols: z.array(z.string().min(1)),
  candidates: z.array(scoutCandidateSchema),
  notes: z.array(z.string()),
})

export type FileScoutOutput = z.infer<typeof fileScoutOutputSchema>

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

export const reviewJudgeDecisionSchema = z.object({
  candidateId: z.string().min(1),
  decision: z.enum([
    "accepted",
    "duplicate",
    "false_positive",
    "unsupported",
    "not_security",
    "invalid_range",
  ]),
  reason: z.string().min(1),
})

export type ReviewJudgeDecision = z.infer<typeof reviewJudgeDecisionSchema>

export const reviewJudgeOutputSchema = reviewReportSchema.extend({
  decisions: z.array(reviewJudgeDecisionSchema),
})

export type ReviewJudgeOutput = z.infer<typeof reviewJudgeOutputSchema>

export const reviewVerificationSchema = z.object({
  summary: z.string().min(1),
  mergeSafetyScore: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
  ]),
  mergeSafetyReason: z.string().min(1),
  verifications: z.array(
    z.object({
      candidateId: z.string().min(1),
      confirmed: z.boolean(),
      confidence: z.number().min(0).max(1),
      reason: z.string().min(1),
    })
  ),
})

export type ReviewVerification = z.infer<typeof reviewVerificationSchema>

export type CandidateFinding = ReviewFinding & {
  candidateId: string
}

export const reviewEvidenceRepairSchema = z.object({
  repairs: z.array(
    z
      .object({
        findingIndex: z.number().int().nonnegative(),
        action: z.enum(["replace", "drop"]),
        finding: reviewFindingSchema.optional(),
        reason: z.string().min(1),
      })
      .superRefine((repair, context) => {
        if (repair.action === "replace" && !repair.finding) {
          context.addIssue({
            code: "custom",
            path: ["finding"],
            message: "Replacement repairs must include a finding.",
          })
        }
      })
  ),
})

export type ReviewEvidenceRepair = z.infer<typeof reviewEvidenceRepairSchema>

export type ScoutFinding = ScoutCandidate & {
  candidateId: string
  scoutFile: string
}

export const safeScoutPathSegment = (value: string) =>
  value.replace(/[^A-Za-z0-9_.-]/g, "_")

export const aggregateScoutFindings = (
  scoutOutputs: FileScoutOutput[]
): ScoutFinding[] =>
  scoutOutputs.flatMap((output, scoutIndex) =>
    output.candidates.map((candidate, candidateIndex) => ({
      candidateId: `scout-${String(scoutIndex + 1).padStart(3, "0")}-${String(
        candidateIndex + 1
      ).padStart(3, "0")}`,
      scoutFile: output.file,
      ...candidate,
    }))
  )

export type FileScoutPlanItem =
  | {
      file: string
      safeFile: string
      status: string
      patch: string
      skipped: null
    }
  | {
      file: string
      safeFile: string
      status: string
      skipped: { reason: "patch_unavailable" }
    }

export const buildFileScoutPlan = (
  files: PullRequestFile[]
): FileScoutPlanItem[] =>
  files.map((file) => {
    const base = {
      file: file.filename,
      safeFile: safeScoutPathSegment(file.filename),
      status: file.status,
    }
    if (!file.patch) {
      return {
        ...base,
        skipped: { reason: "patch_unavailable" },
      }
    }
    return {
      ...base,
      patch: file.patch,
      skipped: null,
    }
  })

const symbolLabel = ({
  kind,
  name,
  signature,
  returnType,
}: {
  kind: string
  name: string
  signature?: string
  returnType?: string
}) => {
  if (signature) return `${kind} ${signature}`
  return returnType ? `${kind} ${name}: ${returnType}` : `${kind} ${name}`
}

export const renderSemanticCoverage = ({
  diffContext,
  codeIndex,
  chunks,
  qdrantEnabled,
}: {
  diffContext: DiffContextResult
  codeIndex: RepositoryCodeIndex
  chunks: CodeChunk[]
  qdrantEnabled: boolean
}) => {
  const indexedFiles = new Set(codeIndex.repositoryFiles)
  const parsedFiles = new Set(codeIndex.files.map((file) => file.path))
  const chunksByFile = new Map<string, CodeChunk[]>()
  for (const chunk of chunks) {
    chunksByFile.set(chunk.file, [
      ...(chunksByFile.get(chunk.file) ?? []),
      chunk,
    ])
  }
  const diagnosticsByFile = new Map<string, string[]>()
  for (const diagnostic of diffContext.diagnostics) {
    if (!diagnostic.file) continue
    diagnosticsByFile.set(diagnostic.file, [
      ...(diagnosticsByFile.get(diagnostic.file) ?? []),
      `${diagnostic.kind}: ${diagnostic.message}`,
    ])
  }

  const lines = [
    "# Semantic Search Coverage",
    "",
    `Semantic search enabled: ${qdrantEnabled ? "yes" : "no"}`,
    `Repository files considered by index policy: ${codeIndex.repositoryFiles.length}`,
    `Parsed files with AST/source chunks: ${codeIndex.files.length}`,
    `Semantic chunks prepared: ${chunks.length}`,
    "",
    "Changed file coverage:",
  ]

  for (const file of diffContext.files) {
    const fileChunks = chunksByFile.get(file.file) ?? []
    const strategies = [...new Set(fileChunks.map((chunk) => chunk.strategy))]
    const warnings: string[] = []
    if (!indexedFiles.has(file.file)) {
      warnings.push("not included by review index policy")
    } else if (!parsedFiles.has(file.file)) {
      warnings.push(
        "not parsed by AST adapter; semantic search has no code chunk"
      )
    }
    if (file.affectedSymbols.length === 0) {
      warnings.push("no affected AST symbols detected")
    }
    if (file.topLevelChangedLines.length > 0) {
      warnings.push("has changed top-level lines")
    }
    if (fileChunks.length === 0) {
      warnings.push("no semantic chunks available; use locate_text/read_file")
    } else if (strategies.includes("file-fallback")) {
      warnings.push("covered by broad file fallback chunk")
    }
    if (strategies.includes("scope-window")) {
      warnings.push("large scope split into window chunks")
    }
    const diagnostics = diagnosticsByFile.get(file.file) ?? []
    warnings.push(...diagnostics)

    lines.push(`- ${file.file}`)
    lines.push(`  - status: ${file.status}`)
    if (file.language) lines.push(`  - language: ${file.language}`)
    lines.push(`  - affected symbols: ${file.affectedSymbols.length}`)
    lines.push(
      `  - top-level changed lines: ${file.topLevelChangedLines.length}`
    )
    lines.push(`  - semantic chunks: ${fileChunks.length}`)
    if (strategies.length > 0) {
      lines.push(`  - chunk strategies: ${strategies.join(", ")}`)
    }
    if (warnings.length > 0) {
      lines.push(`  - notes: ${warnings.join("; ")}`)
    }
  }

  return lines.join("\n").trim()
}

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
          `  - ${symbolLabel(symbol)} ${symbol.startLine}-${symbol.endLine}; touched lines: ${symbol.touchedLines.join(", ")}`
        )
        if (symbol.parameters?.length) {
          lines.push(`    params: ${symbol.parameters.join(", ")}`)
        }
        if (symbol.returnType) lines.push(`    returns: ${symbol.returnType}`)
      }
    } else {
      lines.push("- symbols: none detected")
    }

    if (file.topLevelChangedLines.length > 0) {
      lines.push(
        `- top-level changed lines: ${file.topLevelChangedLines.join(", ")}`
      )
    }
    lines.push("")
  }

  return lines.join("\n").trim()
}

export const renderAffectedSymbolsForFile = (
  context: DiffContextResult,
  filePath: string
) => {
  const file = context.files.find((item) => item.file === filePath)
  if (!file) return "No affected symbols detected for this file."

  const lines = [
    `File: ${file.file}`,
    `Status: ${file.status}`,
    file.language ? `Language: ${file.language}` : undefined,
    `Top-level changed lines: ${
      file.topLevelChangedLines.length > 0
        ? file.topLevelChangedLines.join(", ")
        : "none"
    }`,
    "Affected symbols:",
  ].filter((line): line is string => Boolean(line))

  if (file.affectedSymbols.length === 0) {
    lines.push("- none detected")
  } else {
    for (const symbol of file.affectedSymbols) {
      lines.push(
        `- ${symbolLabel(symbol)} ${symbol.startLine}-${symbol.endLine}; touched lines: ${symbol.touchedLines.join(", ")}`
      )
      if (symbol.parameters?.length) {
        lines.push(`  params: ${symbol.parameters.join(", ")}`)
      }
      if (symbol.returnType) lines.push(`  returns: ${symbol.returnType}`)
    }
  }

  return lines.join("\n").trim()
}

export const fileScoutInstructions = `Find possible security vulnerabilities introduced or exposed by one changed file.

Optimize for recall over precision.

Rules:
- Review only security-relevant risks from this file change and directly connected code.
- Consider whether this file changes authorization, authentication, data exposure, input validation, external calls, secrets, signatures, persistence, state transitions, deserialization, file/network access, trust boundaries, or other security-relevant aspects.
- Use get_symbol_definition and get_symbol_callers when a candidate depends on behavior outside the visible file patch.
- Return every plausible security candidate, including low-confidence candidates, as long as it has a concrete changed-file line range.
- Do not suppress one candidate because another candidate is more severe.
- If there are no plausible security candidates, return an empty candidates array and explain that in notes.
- Each candidate range must be in the pull request head version and should overlap this file change when the issue is caused by this file.`

export const reviewJudgeInstructions = `Judge noisy security candidates for a pull request.

Your job is to verify and deduplicate candidate findings generated by per-file scout agents.

Rules:
- Use the scout candidates as the primary review surface.
- Verify candidate claims against the diff, repository context, and tool-inspected code before including them.
- Return one decision for every scout candidateId you received. Do not silently drop a candidate.
- Use decision "accepted" when the candidate is included as a final finding.
- Use decision "duplicate" only when another accepted finding covers the same root cause and fix.
- Use decision "false_positive" only when the claim is factually false.
- Use decision "unsupported" when the claim might be true but cannot be supported from the diff, repository context, or inspected code.
- Use decision "not_security" only when the claim is real but has no security impact.
- Use decision "invalid_range" only when the candidate is attached to a non-reviewable or clearly wrong changed-line range and you cannot correct it.
- Keep true findings even if they are less severe than other true findings.
- Reject false positives, duplicate findings, unsupported claims, and invalid review ranges.
- You may add independent findings discovered while verifying candidates, especially cross-file or data-flow security issues.
- Do not report style-only feedback or non-security issues.
- Do not drop a true candidate because the behavior might be intentional. If it crosses a trust boundary, expands public data exposure, weakens authentication or authorization, mutates persisted state from untrusted input, or creates replay/forgery risk, include it at the appropriate severity.
- Different root causes or different fixes should remain separate findings even when they appear in the same feature area.
- Every final finding must point to a changed file and a concrete head-side line range that the author can act on.
- The range must be small and specific, preferably 1-8 lines, and overlap an added or modified line in the diff.`

export const reviewVerifierInstructions = `Verify candidate pull request findings for truthfulness only.

Your job is narrow: remove lies, unsupported claims, invalid review ranges, and duplicates. Do not judge whether a true finding is important enough to publish.

Rules:
- Every verification decision must copy the exact candidateId string from the candidate finding it evaluates.
- Confirm a finding when its factual claim is true or reasonably supported by the diff or inspected code.
- Confirm true findings even when they are low severity, light impact, non-blocking, easy to fix, or mostly a maintainability, reliability, performance, UX, documentation, or follow-up concern.
- Confirm true findings even when a more serious finding also exists. Severity is already represented on the finding; do not use verification to suppress light findings.
- Reject a finding only when the claim is false, clearly unsupported by the diff and inspected code, attached to an invalid or non-reviewable range, or duplicates the same underlying issue as another confirmed finding.
- Do not reject a true finding because behavior might be intentional. If the finding accurately describes a real behavior or tradeoff in the changed code, confirm it.
- Do not rewrite findings, change severity, or add new findings.

When a candidate depends on code outside the visible diff, inspect the relevant symbol, callers, or file range before rejecting it.
Use tools only to decide whether the candidate claim is true.`

export const buildFileScoutPrompt = ({
  title,
  body,
  baseRef,
  headRef,
  file,
  status,
  patch,
  affectedSymbols,
}: {
  title: string
  body: string | null
  baseRef: string
  headRef: string
  file: string
  status: string
  patch: string
  affectedSymbols: string
}) => `Pull request title: ${title}
Pull request description: ${body ?? "(none)"}
Base branch: ${baseRef}
Head branch: ${headRef}

Scout file: ${file}
File status: ${status}

File patch:
${patch}

Affected symbols in this file:
${affectedSymbols}`

export const buildReviewJudgePrompt = ({
  title,
  body,
  baseRef,
  headRef,
  diff,
  affectedSymbols,
  repositoryContext,
  scoutFindings,
}: {
  title: string
  body: string | null
  baseRef: string
  headRef: string
  diff: string
  affectedSymbols: string
  repositoryContext?: string | null
  scoutFindings: ScoutFinding[]
}) => `Pull request title: ${title}
Pull request description: ${body ?? "(none)"}
Base branch: ${baseRef}
Head branch: ${headRef}

Repository context:
${repositoryContext ?? "(none)"}

Changed files:
${diff}

Changed symbol index:
${affectedSymbols}

Grouped scout candidate findings JSON:
${JSON.stringify(groupScoutFindingsByFile(scoutFindings), null, 2)}

Decision ledger requirement:
- The decisions array must contain exactly one entry for each candidateId in the grouped scout candidate findings JSON.
- A final finding accepted from a scout candidate should preserve the candidate's core claim, but you may correct severity, wording, and line range.
- Independent findings you add do not need decision entries because they have no scout candidateId.`

export const groupScoutFindingsByFile = (findings: ScoutFinding[]) => {
  const grouped = new Map<string, ScoutFinding[]>()
  for (const finding of findings) {
    grouped.set(finding.scoutFile, [
      ...(grouped.get(finding.scoutFile) ?? []),
      finding,
    ])
  }

  return [...grouped.entries()].map(([file, candidates]) => ({
    file,
    candidates,
  }))
}

export const reviewEvidenceRepairInstructions = `Repair invalid evidence ranges in an existing pull request review report.

Your job is narrow: only fix findings that failed local evidence validation.

Rules:
- Return one repair entry for each invalid findingIndex you receive.
- Use action "replace" when the finding is true and can be attached to a valid changed-line range.
- Use action "drop" when the finding cannot be attached to a valid changed-line range from the provided file context.
- For "replace", preserve the finding's core claim, severity, title, body, and confidence unless a small edit is needed for accuracy.
- For "replace", choose a small concrete file/startLine/endLine range in the pull request head version.
- The replacement range must overlap an added or modified line shown in the provided patch.
- Prefer 1-8 lines. Never exceed 30 lines.
- Do not add new findings.
- Do not rewrite valid findings; they are not included here.`

export const buildReviewEvidenceRepairPrompt = ({
  invalidFindings,
  fileContexts,
}: {
  invalidFindings: unknown
  fileContexts: unknown
}) => `Invalid findings needing evidence repair:
${JSON.stringify(invalidFindings, null, 2)}

Relevant changed-file context:
${JSON.stringify(fileContexts, null, 2)}`

export const buildReviewVerifierPrompt = ({
  title,
  body,
  baseRef,
  headRef,
  diff,
  affectedSymbols,
  repositoryContext,
  semanticCoverage,
  candidates,
}: {
  title: string
  body: string | null
  baseRef: string
  headRef: string
  diff: string
  affectedSymbols: string
  repositoryContext?: string | null
  semanticCoverage?: string | null
  candidates: CandidateFinding[]
}) => `Pull request title: ${title}
Pull request description: ${body ?? "(none)"}
Base branch: ${baseRef}
Head branch: ${headRef}

Repository context:
${repositoryContext ?? "(none)"}

Changed files:
${diff}

Changed symbol index:
${affectedSymbols}${
  semanticCoverage
    ? `

Semantic search coverage:
${semanticCoverage}
`
    : "\n"
}

Candidate findings JSON:
${JSON.stringify({ candidates }, null, 2)}`

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
        `Location: \`${finding.file}:${finding.startLine}-${finding.endLine}\``,
        `Confidence: ${Math.round(finding.confidence * 100)}%`,
        "",
        finding.body,
        ""
      )
    }
  }

  return sections.join("\n").trim()
}

type InlineReviewPublishStatus =
  | { kind: "not_needed" }
  | { kind: "published"; inlineCommentCount: number }
  | { kind: "failed"; error: string }

const renderChangedFiles = (files: PullRequestFile[]) => {
  if (files.length === 0) {
    return "No reviewable changed files."
  }

  return files
    .map(
      (file) =>
        `- \`${file.filename}\` (${file.status}, +${file.additions} -${file.deletions})`
    )
    .join("\n")
}

const renderInlineFindingSummary = (report: ReviewReport) => {
  if (report.findings.length === 0) {
    return "No actionable inline findings."
  }

  return report.findings
    .map(
      (finding) =>
        `- [${finding.severity}] ${finding.title} at \`${finding.file}:${finding.startLine}-${finding.endLine}\``
    )
    .join("\n")
}

export const renderReviewSummaryComment = ({
  report,
  files,
  inlineReview,
}: {
  report: ReviewReport
  files: PullRequestFile[]
  inlineReview: InlineReviewPublishStatus
}) => {
  const sections = [
    "## Review summary",
    "",
    report.summary,
    "",
    "## Changed files",
    "",
    renderChangedFiles(files),
    "",
    "## Merge safety",
    "",
    `**${scoreLabel(report.mergeSafetyScore)}**`,
    "",
    report.mergeSafetyReason,
    "",
    "## Inline findings",
    "",
  ]

  if (inlineReview.kind === "published") {
    sections.push(
      `${inlineReview.inlineCommentCount} inline review comment${
        inlineReview.inlineCommentCount === 1 ? " was" : "s were"
      } published in a GitHub review.`
    )
  } else if (inlineReview.kind === "failed") {
    sections.push(
      "I could not publish the inline GitHub review comments. Findings are listed here so they are not lost.",
      "",
      renderInlineFindingSummary(report),
      "",
      `Publish error: ${inlineReview.error}`
    )
  } else if (report.findings.length === 0) {
    sections.push("No actionable findings.")
  } else {
    sections.push(
      `${report.findings.length} inline review comment${
        report.findings.length === 1 ? " is" : "s are"
      } ready to publish.`
    )
  }

  return sections.join("\n").trim()
}
