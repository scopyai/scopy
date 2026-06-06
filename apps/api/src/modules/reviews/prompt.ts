import { z } from "zod"
import type { CodeChunk, DiffContextResult, RepositoryCodeIndex } from "tools"

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
    }),
  ),
})

export type ReviewVerification = z.infer<typeof reviewVerificationSchema>

export type CandidateFinding = ReviewFinding & {
  candidateId: string
}

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
    chunksByFile.set(chunk.file, [...(chunksByFile.get(chunk.file) ?? []), chunk])
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
      warnings.push("not parsed by AST adapter; semantic search has no code chunk")
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
    lines.push(`  - top-level changed lines: ${file.topLevelChangedLines.length}`)
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
          `  - ${symbolLabel(symbol)} ${symbol.startLine}-${symbol.endLine}; touched lines: ${symbol.touchedLines.join(", ")}`,
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
        `- top-level changed lines: ${file.topLevelChangedLines.join(", ")}`,
      )
    }
    lines.push("")
  }

  return lines.join("\n").trim()
}

export const reviewAgentInstructions = `Review pull requests for bugs, regressions, security issues, and production risks.

Focus on changed behavior and directly related context. Do not report style-only feedback.
Every finding must point to a changed file and a concrete head-side line range that the author can act on.
If there are no actionable issues, return an empty findings array.

Finding output rules:
- Use file, startLine, and endLine as the exact primary code range where the review comment should attach.
- startLine and endLine must be line numbers in the pull request head version of the file.
- The range must be small and specific. Prefer 1-8 lines. Never use a broad function or file range when a narrower range supports the finding.
- The range must overlap an added or modified line in the diff.
- The body is the review comment for that code range. Explain the concrete bug, regression, security risk, or production risk and the practical impact.
- Do not report a finding unless you can identify a valid file/startLine/endLine range.

Required review workflow:
1. Triage the full diff first. Identify changed behavior, affected symbols, and plausible failure modes before calling tools.
2. Use the changed symbol index and symbol tools first. They are the preferred way to inspect code.
3. If a possible finding depends on implementation details not visible in the diff, call get_symbol_definition for the relevant symbol before reporting it.
4. If a possible finding depends on how other code calls a changed symbol, call get_symbol_callers before reporting it.
5. Use locate_text only as a literal locator for exact identifiers, route paths, config keys, env vars, table or column names, imports, or error strings when you do not know which symbol to inspect. After locate_text finds locations, prefer symbol tools for details.
6. Use semantic code search for behavior/concept searches when exact identifiers are unknown. Use a short behavior phrase plus relevant symbol or file names. Do not paste code into semantic search queries.
7. read_file is expensive and broad. Use it only for specific small line ranges when symbol tools, semantic search, and locate_text do not expose the needed context, or when a file has no usable AST coverage.
8. Before returning the report, discard any finding that is not directly supported by the diff or by tool results you inspected.

Merge safety score:
1 = extremely unsafe to merge; critical issues can cause real production damage.
2 = unsafe to merge; serious issues should block merge.
3 = risky; merge only after review or fixes.
4 = mostly safe; minor concerns or low-risk follow-up.
5 = safe to merge; no actionable issues found.`

export const reviewVerifierInstructions = `Verify pull request review reports for false positives and duplicates.

Your job is to confirm, reject, and deduplicate candidate findings. Do not add new findings.
Each candidate finding has a candidateId. Every verification decision must copy the exact candidateId string from the candidate finding it evaluates.
A finding is confirmed only when its file/startLine/endLine range is valid and the exact claim is directly supported by the diff or by tool results you inspect.
If a finding is plausible but not proven, mark it unconfirmed.
If the selected range does not support the claim, mark it unconfirmed even if a nearby issue might exist.
If two findings describe the same underlying problem, confirm the clearest and most specific one and mark the duplicates unconfirmed.
If a finding depends on implementation details outside the diff, inspect the relevant symbol or file range.
If a finding depends on call-site behavior, inspect callers.
Use locate_text only as a locator for exact identifiers, strings, route paths, config keys, env vars, table or column names, and imports. Prefer symbol tools after it returns locations.
Use semantic code search only when the semantic search tool is available and exact text is unknown.`

export const buildReviewAgentPrompt = ({
  title,
  body,
  baseRef,
  headRef,
  diff,
  affectedSymbols,
  semanticCoverage,
}: {
  title: string
  body: string | null
  baseRef: string
  headRef: string
  diff: string
  affectedSymbols: string
  semanticCoverage?: string | null
}) => `Pull request title: ${title}
Pull request description: ${body ?? "(none)"}
Base branch: ${baseRef}
Head branch: ${headRef}

Changed files:
${diff}

Changed symbol index:
${affectedSymbols}${
  semanticCoverage
    ? `

Semantic search coverage:
${semanticCoverage}`
    : ""
}`

export const buildReviewAgentRepairPrompt = ({
  originalPrompt,
  report,
  validation,
}: {
  originalPrompt: string
  report: ReviewReport
  validation: unknown
}) => `${originalPrompt}

The previous review report had invalid finding locations. Return a corrected complete review report.

Rules for this correction pass:
- Keep only actionable findings that have valid file/startLine/endLine ranges.
- Correct invalid ranges when the finding is still supported by the diff or inspected context.
- Drop any finding whose correct range is uncertain.
- Do not invent new findings just to replace invalid ones.
- Return the full report JSON again, not a patch.

Previous report JSON:
${JSON.stringify(report, null, 2)}

Location validation failures:
${JSON.stringify(validation, null, 2)}`

export const buildReviewVerifierPrompt = ({
  title,
  body,
  baseRef,
  headRef,
  diff,
  affectedSymbols,
  semanticCoverage,
  candidates,
}: {
  title: string
  body: string | null
  baseRef: string
  headRef: string
  diff: string
  affectedSymbols: string
  semanticCoverage?: string | null
  candidates: CandidateFinding[]
}) => `Pull request title: ${title}
Pull request description: ${body ?? "(none)"}
Base branch: ${baseRef}
Head branch: ${headRef}

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
        "",
      )
    }
  }

  return sections.join("\n").trim()
}
