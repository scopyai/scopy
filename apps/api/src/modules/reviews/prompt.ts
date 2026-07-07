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

export const reviewVerifierVerdictSchema = z
  .object({
    suspicionId: z.string().min(1),
    verdict: z.enum([
      "approved",
      "rejected",
      "dropped_low_value",
      "needs_main_review",
    ]),
    reviewPriority: z.enum(["critical", "high", "medium", "low"]),
    confidence: z.number().min(0).max(1),
    reason: z.string().min(1),
    finding: reviewFindingSchema.nullable(),
  })
  .superRefine((verdict, validation) => {
    if (verdict.verdict === "approved" && verdict.finding === null) {
      validation.addIssue({
        code: "custom",
        path: ["finding"],
        message: "Approved verifier verdicts must include a finding.",
      })
    }
    if (verdict.verdict !== "approved" && verdict.finding !== null) {
      validation.addIssue({
        code: "custom",
        path: ["finding"],
        message: "Non-approved verifier verdicts must set finding to null.",
      })
    }
  })

export const reviewVerifierOutputSchema = z.object({
  verdicts: z.array(reviewVerifierVerdictSchema),
})

export const reviewDuplicateFindingGroupSchema = z.object({
  keepIndex: z.number().int().nonnegative(),
  duplicateIndexes: z.array(z.number().int().nonnegative()).min(1),
  reason: z.string().min(1),
})

export const reviewFindingDeduplicationOutputSchema = z.object({
  duplicateGroups: z.array(reviewDuplicateFindingGroupSchema),
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

export const mainReviewAgentWithVerificationInstructions = `Review a pull request for actionable bugs using repository tools and delegated exploration.

You are the central reviewer. First understand the changed architecture, areas, and end-to-end flows. Use spawn_review_agents to delegate focused explorations to cheaper agents. The tool runs a cheaper verification layer over subagent suspicions before returning them to you.

Rules:
- Cover correctness, security, reliability, data flow, state transitions, persistence, concurrency, API contracts, integrations, performance, and user-facing regressions. Exclude style-only feedback.
- Give subagents specific areas or flows to explore, not individual files by default. Ensure the combined tasks cover every materially affected direction.
- spawn_review_agents returns compact approvedFindings, needsMainReview, and verificationStats.
- Treat approvedFindings as already independently verified by the verifier layer. They will be automatically included in the published report after evidence validation. Use them only to avoid publishing the same root cause again; do not spend tool calls re-verifying them, and do not duplicate them in your findings.
- Independently inspect and decide only the suspicions returned in needsMainReview. These are high-priority unresolved cases, not the full subagent suspicion stream.
- Optimize verification of needsMainReview items for precision and concrete impact. The cheap verifier layer already protects recall for the broader suspicion stream.
- Do not accept a needsMainReview suspicion because it is merely plausible. Inspect the relevant code and flow, then publish it only when it is concrete, harmful, actionable, and introduced or exposed by this pull request.
- Mark a needsMainReview suspicion as duplicate only when an accepted suspicion or an approvedFinding covers the same root cause and fix. Mark it as not_bug only when its factual claim is false or the described behavior cannot cause an adverse outcome.
- Every accepted decision must set findingIndex to the zero-based index of the finding in your own findings array that represents it. Duplicate and not_bug decisions must set findingIndex to null.
- Determine final severity, confidence, wording, and location yourself for findings you publish from needsMainReview or discover independently.
- You may discover and publish findings that subagents did not suggest.
- Every final finding must describe a concrete failure introduced or exposed by the pull request and point to a small, actionable range in a changed file on the head version.
- Final ranges should preferably span 1-8 lines, never more than 30, and overlap an added or modified line.
- Do not publish speculative claims as findings. It is valid to mark an escalated suspicion not_bug when inspection cannot prove a concrete adverse outcome.
- Write summary as a concise description of the pull request's purpose and behavior added, changed, or removed. Do not focus it on findings or bugs.
- Include every changed file in changedFiles using its exact repository-relative path and one concise sentence describing the meaningful change, not Git status or line counts.
- Add reviewerAttention items only when a specific area genuinely needs human judgment or verification beyond the findings. Do not duplicate findings, add generic advice, or force this section; return an empty array when it is not needed.
- The decisions array must contain exactly one decision for every suspicionId returned in needsMainReview across all spawn_review_agents calls. Do not include decisions for approvedFindings or rejectedSuspicionIds. Every decision needs a concrete reason grounded in inspected behavior.`

export const reviewVerifierInstructions = `Verify subagent suspicions for an AI pull request review.

You are a strict verification manager. Your job is to turn recall-heavy subagent suspicions into terminal decisions or a small high-priority queue for the main reviewer.

Rules:
- Return exactly one verdict for every supplied suspicionId. Do not add, omit, rename, merge, split, or reorder suspicion IDs.
- Include confidence from 0 to 1 for every verdict. Confidence is your confidence in the verdict itself, not in the severity.
- Include reviewPriority for every verdict: critical, high, medium, or low. This is the priority for expensive main review, based on potential user impact, data impact, operational impact, blast radius, and likelihood that the pull request introduced or exposed the behavior.
- Use approved only when direct repository evidence makes the suspicion factually correct, harmful, actionable, and worth publishing without main review.
- Use rejected only when direct repository evidence shows the suspicion's factual claim is false, already handled, not introduced or exposed by the pull request, not harmful, or not actionable.
- Use dropped_low_value when the suspicion may be partly plausible but is too speculative, low-impact, product-policy dependent, or marginal to spend expensive main-review tokens on.
- Use needs_main_review only when the suspicion remains materially uncertain after tool inspection and reviewPriority is high or critical.
- For approved verdicts, include a polished finding with severity, file, startLine, endLine, title, body, and confidence.
- Approved finding ranges must be small, head-side ranges in changed files, and should overlap an added or modified line listed in the changed-line map.
- For rejected, dropped_low_value, and needs_main_review verdicts, set finding to null.
- Prefer dropped_low_value over needs_main_review for uncertain low- or medium-priority suspicions.
- Prefer needs_main_review over approved whenever a high- or critical-priority suspicion depends on uncertain product intent, ambiguous external contracts, or uninspected runtime behavior.
- Do not escalate low-priority uncertainty. Make the cheapest defensible terminal decision instead.
- Use repository tools to inspect the files, definitions, callers, wrappers, and related flows needed to prove or disprove the supplied suspicions.
- Do not reject a suspicion only because you have not finished proving it. If it is high or critical priority, escalate it with needs_main_review; otherwise use dropped_low_value.`

export const reviewFindingDeduplicationInstructions = `Identify exact duplicate findings in a pull request review.

Rules:
- Return duplicate groups only when findings describe the same root cause, same adverse behavior, and same required fix.
- Do not group findings merely because they touch the same file, line range, component, or broad area.
- If two findings are related but would require different fixes or describe different failure modes, they are not duplicates.
- Prefer keeping the clearer, more specific, or higher severity finding.
- Return an empty duplicateGroups array when there are no exact duplicates.`

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

export const buildReviewVerifierPrompt = ({
  title,
  body,
  baseRef,
  headRef,
  taskId,
  taskObjective,
  changedLineMap,
  suspicions,
}: {
  title: string
  body: string | null
  baseRef: string
  headRef: string
  taskId: string
  taskObjective: string
  changedLineMap: string
  suspicions: Array<{
    suspicionId: string
    file: string
    startLine: number
    endLine: number
    suspicion: string
  }>
}) => `Pull request title: ${title}
Pull request description: ${body ?? "(none)"}
Base branch: ${baseRef}
Head branch: ${headRef}

Subagent task: ${taskId}
Task objective:
${taskObjective}

Changed-line map:
${changedLineMap}

Suspicion candidates:
${suspicions
  .map(
    (suspicion, index) => `${index + 1}. suspicionId: ${suspicion.suspicionId}
file: ${suspicion.file}
range: ${suspicion.startLine}-${suspicion.endLine}
claim: ${suspicion.suspicion}`
  )
  .join("\n\n")}`

export const buildReviewFindingDeduplicationPrompt = ({
  findings,
}: {
  findings: Array<{
    index: number
    severity: string
    file: string
    startLine: number
    endLine: number
    title: string
    body: string
    confidence: number
  }>
}) => `Findings JSON:
${JSON.stringify(findings, null, 2)}

Return exact duplicate groups by index.`

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
