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

export type ReviewSeverity = ReviewFinding["severity"]

export const severityRank: Record<ReviewSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
}

export const candidateFindingSchema = reviewFindingSchema.extend({
  evidence: z.string().min(1),
})

export type CandidateFinding = z.infer<typeof candidateFindingSchema> & {
  id: string
  taskId: string
  supportingTaskIds: string[]
}

export const reviewSubagentOutputSchema = z.object({
  findings: z.array(candidateFindingSchema),
})

export const reviewVerifierVerdictSchema = z.object({
  id: z.string().min(1),
  verdict: z.enum(["approve", "reject", "escalate"]),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1),
})

export const reviewVerifierOutputSchema = z.object({
  verdicts: z.array(reviewVerifierVerdictSchema),
})

export const reviewDecisionSchema = z.object({
  id: z.string().min(1),
  decision: z.enum(["accept", "reject", "duplicate"]),
  reason: z.string().min(1),
  findingIndex: z.number().int().nonnegative().nullable(),
})

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

export const mainReviewReportSchema = reviewReportSchema.omit({
  summary: true,
  changedFiles: true,
})

export const reportComposerOutputSchema = z.object({
  files: z.array(
    z.object({
      file: z.string().min(1),
      summary: z.string().min(1),
    })
  ),
})

export const reportSummaryOutputSchema = z.object({
  summary: z.string().min(1),
})

export type ReviewReport = Omit<
  z.infer<typeof reviewReportSchema>,
  "findings"
> & {
  findings: ReviewFinding[]
}

export const safePathSegment = (value: string) =>
  value.replace(/[^A-Za-z0-9_.-]/g, "_")

export const reviewSubagentInstructions = `Explore the assigned area of a pull request and report every plausible bug as a finding.

Optimize aggressively for recall, not precision. Follow data and control flow across the repository instead of limiting yourself to one changed file.

Rules:
- Find every plausible correctness, security, reliability, state, persistence, concurrency, API-contract, integration, performance, or user-facing failure related to the assigned area.
- Include speculative findings and edge cases. Do not discard a possibility because it is uncertain, difficult to prove, low impact, or overlaps another finding.
- A single line or call site can host several independent defects (for example one request that is unvalidated, has no timeout, and leaks a secret). Report each distinct defect as its own finding, even when they share the exact same lines; reporting one defect at a location does not cover the others.
- If the prompt lists already reported findings, do not re-report them or variants sharing their root cause. They are handled; your value is in what they miss. The files they live in are proven bug-dense, so re-inspect those files for different defects instead of avoiding them.
- Inspect all files, definitions, callers, and related flows needed to explore the area thoroughly.
- Explore the assigned area evenly. Changed files that look routine, mechanical, or uninteresting get the same scrutiny as the obviously risky ones; do not conclude the area is clean while any of its changed files remains uninspected.
- For each finding return the most relevant repository-relative file, head-side start and end lines overlapping a changed line, a short title, and a body explaining what goes wrong and in what scenario. Keep the line range small and actionable: preferably 1-8 lines, never more than 30. Approved findings are published with your exact range, and ranges that cannot be anchored to the diff are discarded.
- severity is the worst-case impact if the finding is real: critical (data loss, security breach, or outage), high (serious user-facing or data defect), medium (real defect with limited blast radius), low (minor or edge-case defect). Critical and high findings are routed directly to an expensive reviewer, so do not inflate severity; base it on impact, not on your certainty.
- confidence from 0 to 1 is how likely the finding is real given what you inspected. Uncertain findings belong in the output with low confidence, not omitted.
- evidence: the decisive code excerpts you already inspected, quoted verbatim with repository-relative file paths and line numbers, plus the control- or data-flow connection between them. If you could not settle the finding yourself, name the specific fact that would prove or refute it. Downstream reviewers judge from this packet without re-reading the repository, so make it self-contained.
- Return an empty findings array only after thoroughly exploring the assigned area and finding no plausible failure.`

export const reviewVerifierInstructions = `Verify candidate bug findings for an AI pull request review.

Each candidate was produced by a recall-heavy explorer agent and carries an evidence packet. Use repository tools to inspect the files, definitions, callers, and related flows needed to prove or disprove each candidate, then return exactly one verdict per candidate id.

Verdicts:
- approve: direct repository evidence confirms the factual claim and the described harm is concrete, actionable, and introduced or exposed by this pull request. Approved findings are published as-is, so approve only findings whose title, body, and line range are accurate.
- reject: direct repository evidence disproves the candidate - the claimed missing guard exists, the behavior is unreachable, it is not introduced or exposed by this pull request, or it cannot cause an adverse outcome. Rejection requires disproving evidence; never reject a candidate merely because you did not finish proving it.
- escalate: the candidate remains materially uncertain after inspection, or it depends on product intent, ambiguous external contracts, or runtime behavior you cannot inspect. Escalated candidates go to an expensive reviewer, so escalate sparingly - but prefer escalate over reject whenever the factual claim stands unrefuted.

Rules:
- Return exactly one verdict for every supplied candidate id. Do not add, omit, or duplicate ids.
- confidence from 0 to 1 is your confidence in the verdict itself, and it must reflect the weakest premise in the scenario, not the strength of the code mechanism.
- Distinguish the trigger from the premise. A finding may rest on an unproven trigger condition (a request fails, an attacker supplies input, a slow endpoint stalls), but not on an unproven premise about how the code, its callers, or its data actually behave ("callers were written around the old value", "this cache goes stale over time"). If the failure scenario needs a fact about the repository you have not verified, verify it with the tools; if the premise cannot be verified, do not approve on plausibility - escalate or reject.
- Route-level authentication is not authorization. Do not reject a missing-ownership or missing-scoping candidate because the endpoint requires an authenticated session; either quote the resource-level check that scopes access or treat the factual claim as confirmed.
- If inspection confirms the factual claim - for example a guard, check, or handling the candidate says is missing is indeed absent - choose approve or escalate, never reject.`

export const mainReviewAgentInstructions = `Review a pull request for actionable bugs by delegating exploration to cheaper agents and judging what they escalate.

You are the central reviewer. Your prompt contains a changed-files overview instead of full patches; exploration belongs to subagents, and your own tool calls are reserved for settling decisive facts. Work in phases.

Phase 1 - delegate immediately:
- From the changed-files overview, repository context, and changed symbol index alone, partition the materially affected areas and end-to-end flows into focused tasks and call spawn_review_agents as your first action. Do not read patches or files before delegating.
- Give subagents specific areas or flows to explore, not individual files by default. Ensure the combined tasks cover every materially affected direction.
- You may call spawn_review_agents again for follow-up batches when earlier results reveal an uncovered direction.
- spawn_review_agents returns uncoveredFiles: changed files no subagent has read or reported a finding in yet. A file looking boring is not evidence it is safe; when uncovered files could plausibly hide a defect, cover them with a follow-up batch before reporting.

Phase 2 - decide the review queue:
- spawn_review_agents deduplicates subagent findings, auto-verifies the low-severity ones with a cheaper verifier, and returns two lists: approvedFindings and reviewQueue.
- approvedFindings are already verified and will be published automatically unless you veto them in phase 3. Do not re-verify them with tools, do not include them in your findings, and do not accept a queue item whose root cause they already cover.
- reviewQueue contains the high-severity findings and the verifier's escalations. Decide every queue item yourself: accept, reject, or duplicate. Each item carries an evidence packet - quoted code with locations and flow reasoning. Judge from the packet by default.
- Use a tool only when a packet leaves a decisive fact unresolved. Name that fact first, then fetch the smallest thing that settles it: read_patch for one changed file's diff, or read_file, get_symbol_definition, get_symbol_callers, locate_text for repository state. Batch independent lookups into one step and spend at most two tool calls per item.
- Cover correctness, security, reliability, data flow, state transitions, persistence, concurrency, API contracts, integrations, performance, and user-facing regressions. Exclude style-only feedback.
- Accept an item only when it is concrete, harmful, actionable, and introduced or exposed by this pull request. Mark it duplicate only when an accepted item or an approvedFinding covers the same root cause and fix. Mark it reject only when its factual claim is false or the described behavior cannot cause an adverse outcome.
- A supportingTaskIds list with more than one entry means independent subagents flagged the same location; treat that agreement as evidence worth extra scrutiny before rejecting.

Phase 3 - report:
- The decisions array must contain exactly one decision for every reviewQueue id across all spawn_review_agents calls, each with a concrete reason grounded in the evidence packet or inspected behavior.
- Every accept decision must set findingIndex to the zero-based index of the finding in your findings array that represents it; reject and duplicate decisions must set findingIndex to null.
- Determine final severity, confidence, wording, and location yourself for the findings you publish. You may also publish findings you discovered independently.
- Every finding must describe a concrete failure introduced or exposed by the pull request and point to a small, actionable range in a changed file on the head version: preferably 1-8 lines, never more than 30, overlapping an added or modified line.
- Do not write a pull request summary or per-file change descriptions; a separate agent composes those sections.
- Give the approvedFindings one final read against everything you now know about the pull request. List an id in vetoedApprovedFindings, with a short reason, only when your acquired context shows the finding is not a real defect: its failure scenario rests on a premise the code disproves, its factual claim is wrong, or another published finding already covers its root cause. Do not veto over severity, wording, or taste, and do not spend tool calls on this pass; leave the array empty when everything holds.
- Base mergeSafetyScore and mergeSafetyReason on everything that will be published: your accepted findings, your independent findings, and the approvedFindings from spawn_review_agents that you did not veto.
- Add reviewerAttention items only when a specific area genuinely needs human judgment beyond the findings; return an empty array otherwise.`

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

export const reportComposerInstructions = `Summarize pull request file changes for a review report.

Rules:
- For each assigned changed file, return exactly one files entry with the exact repository-relative path.
- summary is one concise sentence describing the meaningful behavior added, changed, or removed in that file, not Git status or line counts.
- Describe what the change does. Do not evaluate whether it is good, buggy, or risky.
- Do not return entries for files that were not assigned.`

export const reportSummaryInstructions = `Write the summary section of a pull request review.

Rules:
- Write a concise description of the pull request's purpose and the behavior added, changed, or removed.
- Base it only on the pull request metadata and per-file change summaries provided.
- Do not mention findings, bugs, risk, or the review process.`

const renderCandidate = (candidate: CandidateFinding, index: number) =>
  `${index + 1}. id: ${candidate.id}
severity: ${candidate.severity} (confidence ${candidate.confidence})
file: ${candidate.file}
range: ${candidate.startLine}-${candidate.endLine}
title: ${candidate.title}
claim: ${candidate.body}
evidence:
${candidate.evidence}`

export const buildReviewVerifierPrompt = ({
  title,
  body,
  baseRef,
  headRef,
  changedLineMap,
  candidates,
}: {
  title: string
  body: string | null
  baseRef: string
  headRef: string
  changedLineMap: string
  candidates: CandidateFinding[]
}) => `Pull request title: ${title}
Pull request description: ${body ?? "(none)"}
Base branch: ${baseRef}
Head branch: ${headRef}

Changed-line map:
${changedLineMap}

Candidate findings:
${candidates.map(renderCandidate).join("\n\n")}`

export const buildMainReviewPrompt = ({
  title,
  body,
  baseRef,
  headRef,
  changedFilesOverview,
  affectedSymbols,
  repositoryContext,
}: {
  title: string
  body: string | null
  baseRef: string
  headRef: string
  changedFilesOverview: string
  affectedSymbols: string
  repositoryContext?: string | null
}) => `Pull request title: ${title}
Pull request description: ${body ?? "(none)"}
Base branch: ${baseRef}
Head branch: ${headRef}

Repository context:
${repositoryContext ?? "(none)"}

Changed files overview (use the read_patch tool for a file's full diff):
${changedFilesOverview}

Changed symbol index:
${affectedSymbols}`

export const buildReportComposerPrompt = ({ diff }: { diff: string }) =>
  `Assigned changed files:
${diff}`

export const buildReportSummaryPrompt = ({
  title,
  body,
  baseRef,
  headRef,
  fileSummaries,
}: {
  title: string
  body: string | null
  baseRef: string
  headRef: string
  fileSummaries: Array<{ file: string; summary: string }>
}) => `Pull request title: ${title}
Pull request description: ${body ?? "(none)"}
Base branch: ${baseRef}
Head branch: ${headRef}

Per-file change summaries:
${fileSummaries.map((entry) => `- ${entry.file}: ${entry.summary}`).join("\n")}`

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

const compressLineRanges = (lines: number[]) => {
  if (lines.length === 0) return "none"
  const sorted = [...new Set(lines)].sort((first, second) => first - second)
  const ranges: string[] = []
  let start = sorted[0]!
  let end = sorted[0]!
  for (const line of sorted.slice(1)) {
    if (line === end + 1) {
      end = line
      continue
    }
    ranges.push(start === end ? `${start}` : `${start}-${end}`)
    start = line
    end = line
  }
  ranges.push(start === end ? `${start}` : `${start}-${end}`)
  return ranges.join(", ")
}

export const renderChangedFilesOverview = ({
  files,
  omittedFiles,
  changedLinesByFile,
}: {
  files: Array<{
    filename: string
    status: string
    additions: number
    deletions: number
  }>
  omittedFiles: Array<{ filename: string; omittedReason?: string }>
  changedLinesByFile: Map<string, number[]>
}) => {
  const lines: string[] = []
  for (const file of files) {
    lines.push(
      `- ${file.filename} (${file.status}, +${file.additions} -${file.deletions}; changed head lines: ${compressLineRanges(changedLinesByFile.get(file.filename) ?? [])})`
    )
  }
  for (const file of omittedFiles) {
    lines.push(`- ${file.filename} (${file.omittedReason ?? "patch omitted"})`)
  }
  return lines.length > 0 ? lines.join("\n") : "(none)"
}

export const renderChangedLineMap = (
  changedLinesByFile: Map<string, number[]>
) => {
  const lines = [...changedLinesByFile.entries()]
    .sort(([first], [second]) => first.localeCompare(second))
    .map(
      ([file, changedLines]) => `- ${file}: ${compressLineRanges(changedLines)}`
    )
  return lines.length > 0 ? lines.join("\n") : "(none)"
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
