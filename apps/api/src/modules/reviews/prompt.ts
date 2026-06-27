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

export type ReviewFinding = z.infer<typeof reviewFindingSchema> & {
  source?: "review" | "natural_language_linter"
}

export const naturalLanguageLinterFindingSchema = z.object({
  ruleIndex: z.number().int().nonnegative(),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  title: z.string().min(1),
  body: z.string().min(1),
  confidence: z.number().min(0).max(1),
})

export const naturalLanguageLinterOutputSchema = z.object({
  files: z.array(
    z.object({
      file: z.string().min(1),
      findings: z.array(naturalLanguageLinterFindingSchema),
    })
  ),
})

export type NaturalLanguageLinterOutput = z.infer<
  typeof naturalLanguageLinterOutputSchema
>

export const reviewSuspicionSchema = z.object({
  file: z.string().min(1),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  suspicion: z.string().min(1),
})

export const reviewSubagentOutputSchema = z.object({
  suspicions: z.array(reviewSuspicionSchema),
})

export const reviewSuspicionDecisionSchema = z.object({
  suspicionId: z.string().min(1),
  decision: z.enum(["accepted", "duplicate", "not_bug"]),
  reason: z.string().min(1),
  findingIndex: z.number().int().nonnegative().nullable(),
})

export const reviewReportSchema = z.object({
  summary: z.string().min(1),
  changedFiles: z.array(
    z.object({
      file: z.string().min(1),
      summary: z.string().min(1),
    })
  ),
  reviewerAttention: z.array(z.string().min(1)),
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

export type ReviewReport = Omit<
  z.infer<typeof reviewReportSchema>,
  "findings"
> & {
  findings: ReviewFinding[]
}

export const safePathSegment = (value: string) =>
  value.replace(/[^A-Za-z0-9_.-]/g, "_")

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

export const reviewSubagentInstructions = `Explore the assigned area of a pull request for anything that could go wrong.

Optimize aggressively for recall, not precision. Follow data and control flow across the repository instead of limiting yourself to one changed file.

Rules:
- Find every plausible correctness, security, reliability, state, persistence, concurrency, API-contract, integration, performance, or user-facing failure related to the assigned area.
- Include speculative suspicions and edge cases. Do not discard a possibility because it is uncertain, difficult to prove, low impact, or overlaps another suspicion.
- Inspect all files, definitions, callers, and related flows needed to explore the area thoroughly.
- Do not verify, deduplicate, prioritize, assign severity or confidence, or decide whether a suspicion should be published. Evaluation belongs entirely to the main agent.
- Do not return summaries, evidence ledgers, uncertainty fields, inspected-symbol metadata, or recommendations.
- For each suspicion return only the most relevant repository-relative file, head-side start and end lines, and a detailed explanation of what might go wrong and in what scenario.
- Return an empty suspicions array only after thoroughly exploring the assigned area and finding no plausible failure.`

export const naturalLanguageLinterInstructions = `Check pull request file changes against configured natural-language rules.

Rules:
- Only report violations of the configured natural-language rules. Do not look for general bugs.
- Evaluate every assigned file against every rule.
- For each assigned file, return exactly one files entry with the exact repository-relative path.
- Use findings: [] when a file has no rule violations.
- Report only concrete violations visible in the provided patch.
- Every finding must point to a small head-side changed line range in the assigned file.
- Do not report findings for deleted files or unchanged context lines.
- ruleIndex must be the zero-based index of the violated rule.`

export const mainReviewAgentInstructions = `Review a pull request for actionable bugs using repository tools and delegated exploration.

You are the central reviewer and the only agent responsible for judgment. First understand the changed architecture, areas, and end-to-end flows. Use spawn_review_agents to delegate focused explorations to cheaper agents. You may call it repeatedly, including follow-up batches based on earlier results.

Rules:
- Cover correctness, security, reliability, data flow, state transitions, persistence, concurrency, API contracts, integrations, performance, and user-facing regressions. Exclude style-only feedback.
- Give subagents specific areas or flows to explore, not individual files by default. Ensure the combined tasks cover every materially affected direction.
- Treat subagent outputs only as untrusted suspicions. Independently inspect and verify every plausible claim with repository tools.
- Optimize verification for recall. A true low-severity, non-security, inconvenient, or possibly intentional regression is still a bug and must not be discarded for lack of importance.
- Do not treat uncertainty as evidence that a suspicion is false. Inspect the relevant code and flow before deciding it is not a bug. Use follow-up tools or subagents when the available context is insufficient.
- Mark a suspicion as duplicate only when an accepted suspicion covers the same root cause and fix. Mark it as not_bug only when its factual claim is false or the described behavior cannot cause an adverse outcome.
- Every accepted decision must set findingIndex to the zero-based index of the final finding that represents it. Duplicate and not_bug decisions must set findingIndex to null.
- Determine final severity, confidence, wording, and location yourself.
- You may discover and publish findings that subagents did not suggest.
- Every final finding must describe a concrete failure introduced or exposed by the pull request and point to a small, actionable range in a changed file on the head version.
- Final ranges should preferably span 1-8 lines, never more than 30, and overlap an added or modified line.
- Do not publish speculative claims as findings, but do not silently discard any suspicion.
- Write summary as a concise description of the pull request's purpose and behavior added, changed, or removed. Do not focus it on findings or bugs.
- Include every changed file in changedFiles using its exact repository-relative path and one concise sentence describing the meaningful change, not Git status or line counts.
- Add reviewerAttention items only when a specific area genuinely needs human judgment or verification beyond the findings. Do not duplicate findings, add generic advice, or force this section; return an empty array when it is not needed.
- The decisions array must contain exactly one decision for every suspicionId returned by spawn_review_agents across all batches. Every decision needs a concrete reason grounded in inspected behavior.`

export const buildMainReviewPrompt = ({
  title,
  body,
  baseRef,
  headRef,
  diff,
  affectedSymbols,
  repositoryContext,
}: {
  title: string
  body: string | null
  baseRef: string
  headRef: string
  diff: string
  affectedSymbols: string
  repositoryContext?: string | null
}) => `Pull request title: ${title}
Pull request description: ${body ?? "(none)"}
Base branch: ${baseRef}
Head branch: ${headRef}

Repository context:
${repositoryContext ?? "(none)"}

Changed files:
${diff}

Changed symbol index:
${affectedSymbols}`

export const buildNaturalLanguageLinterPrompt = ({
  rules,
  diff,
  fileContext,
}: {
  rules: string[]
  diff: string
  fileContext: string
}) => `Natural-language rules:
${rules.map((rule, index) => `${index}. ${rule}`).join("\n")}

Assigned changed files:
${diff}

Head-side numbered file excerpts:
${fileContext}`

const scoreLabel = (score: ReviewReport["mergeSafetyScore"]) => {
  if (score === 1) return "1/5 - extremely unsafe"
  if (score === 2) return "2/5 - unsafe"
  if (score === 3) return "3/5 - risky"
  if (score === 4) return "4/5 - mostly safe"
  return "5/5 - safe"
}

export const findingLabel = (finding: ReviewFinding) =>
  finding.source === "natural_language_linter"
    ? "LINTING"
    : finding.severity.toUpperCase()

const splitFindings = (findings: ReviewFinding[]) => ({
  bugFindings: findings.filter(
    (finding) => finding.source !== "natural_language_linter"
  ),
  lintFindings: findings.filter(
    (finding) => finding.source === "natural_language_linter"
  ),
})

const renderFindingDetails = (finding: ReviewFinding) =>
  [
    `### [${findingLabel(finding)}] ${finding.title}`,
    "",
    `Location: \`${finding.file}:${finding.startLine}-${finding.endLine}\``,
    `Confidence: ${Math.round(finding.confidence * 100)}%`,
    "",
    finding.body,
    "",
  ].join("\n")

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
    const { bugFindings, lintFindings } = splitFindings(report.findings)
    if (bugFindings.length > 0) {
      sections.push("Bug findings are listed first, ordered by severity.", "")
      for (const finding of bugFindings) {
        sections.push(renderFindingDetails(finding))
      }
    }
    if (lintFindings.length > 0) {
      sections.push(
        "## Linting rule violations",
        "",
        "The findings below come from configured natural-language linting rules.",
        ""
      )
      for (const finding of lintFindings) {
        sections.push(renderFindingDetails(finding))
      }
    }
  }

  return sections.join("\n").trim()
}

type InlineReviewPublishStatus =
  | { kind: "not_needed" }
  | { kind: "failed"; error: string }

const renderChangedFiles = (files: ReviewReport["changedFiles"]) => {
  if (files.length === 0) {
    return "No reviewable changed files."
  }

  return files.map((file) => `- \`${file.file}\` - ${file.summary}`).join("\n")
}

const renderInlineFindingSummary = (report: ReviewReport) => {
  if (report.findings.length === 0) {
    return "No actionable inline findings."
  }

  const renderFindingLine = (finding: ReviewFinding) =>
    `- [${findingLabel(finding)}] ${finding.title} at \`${finding.file}:${finding.startLine}-${finding.endLine}\``
  const { bugFindings, lintFindings } = splitFindings(report.findings)
  const sections: string[] = []

  if (bugFindings.length > 0) {
    sections.push(
      "Bug findings:",
      ...bugFindings.map((finding) => renderFindingLine(finding))
    )
  }

  if (lintFindings.length > 0) {
    sections.push(
      ...(sections.length > 0 ? [""] : []),
      "Linting rule violations:",
      ...lintFindings.map((finding) => renderFindingLine(finding))
    )
  }

  return sections.join("\n")
}

export const renderReviewSummaryComment = ({
  report,
  inlineReview,
}: {
  report: ReviewReport
  inlineReview: InlineReviewPublishStatus
}) => {
  const sections = [
    "## Review summary",
    "",
    report.summary,
    "",
    "## Changed files",
    "",
    renderChangedFiles(report.changedFiles),
  ]

  if (report.reviewerAttention.length > 0) {
    sections.push(
      "",
      "## Reviewer attention",
      "",
      ...report.reviewerAttention.map((item) => `- ${item}`)
    )
  }

  sections.push(
    "",
    "## Merge safety",
    "",
    `**${scoreLabel(report.mergeSafetyScore)}**`,
    "",
    report.mergeSafetyReason
  )

  if (inlineReview.kind === "failed") {
    sections.push(
      "",
      "## Findings",
      "",
      "I could not publish all inline GitHub review comments. Findings are listed here so they are not lost.",
      "",
      renderInlineFindingSummary(report),
      "",
      `Publish error: ${inlineReview.error}`
    )
  }

  return sections.join("\n").trim()
}
