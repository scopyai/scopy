import { z } from "zod"
import type { CodeChunk, DiffContextResult, RepositoryCodeIndex } from "tools"

export const reviewFindingSchema = z.object({
  severity: z.enum(["critical", "high", "medium", "low"]),
  file: z.string().min(1),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  title: z.string().min(1),
  body: z.string().min(1),
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
  reason: z.string().min(1),
  evidence: z.string().min(1),
})

export const reviewVerifierOutputSchema = reviewVerifierVerdictSchema

export const mainRejectionChallengeSchema = z.object({
  id: z.string().min(1),
  verdict: z.enum(["uphold_rejection", "return_to_main"]),
  reason: z.string().min(1),
  evidence: z.string().min(1),
})

export const reviewDecisionSchema = z.object({
  id: z.string().min(1),
  decision: z.enum(["accept", "reject", "duplicate"]),
  reason: z.string().min(1),
  evidence: z.string().min(1),
  findingIndex: z.number().int().nonnegative().nullable(),
})

export const naturalLanguageLinterFindingSchema = z.object({
  ruleIndex: z.number().int().nonnegative(),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
  title: z.string().min(1),
  body: z.string().min(1),
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

export const reviewSubagentInstructions = `Explore the assigned area of a pull request and generate every plausible bug hypothesis you can find.

You are a hypothesis generator, not the final judge. Optimize aggressively for recall. Search broadly and deeply across the repository instead of limiting yourself to one changed file.

Rules:
- Report uncertain and incomplete possibilities. Do not discard a possibility because it is difficult to prove, seems unlikely, has limited impact, or overlaps another finding.
- A single line or call site can host several independent defects. Report each distinct defect as its own finding, even when they share the exact same lines; reporting one defect at a location does not cover the others.
- If the prompt lists already reported findings, do not re-report them or variants sharing their root cause. They are handled; your value is in what they miss. The files they live in are proven bug-dense, so re-inspect those files for different defects instead of avoiding them.
- Inspect as much relevant code as needed to understand the change and its effects.
- Explore the assigned area evenly. Do not conclude it is clean while any part remains uninspected.
- Finding one issue is not a stopping condition. Continue searching for distinct issues until you have fully explored the assigned area.
- Make several fresh passes over the area. In each pass, challenge your earlier view and look for paths or assumptions you have not considered yet.
- For each finding return the most relevant repository-relative file, head-side start and end lines overlapping a changed line, a short title, and a body explaining what goes wrong and in what scenario. Keep the line range small and actionable: preferably 1-8 lines, never more than 30. Approved findings are published with your exact range, and ranges that cannot be anchored to the diff are discarded.
- severity describes the potential impact if the hypothesis is real. Base it on impact, not certainty.
- evidence is the strongest starting evidence you found, with repository-relative paths and line numbers. If the hypothesis remains uncertain, state the exact unresolved fact. Later agents will inspect the repository themselves.
- Return an empty findings array only after thoroughly exploring the assigned area and finding no plausible failure.`

export const reviewSubagentDocsInstructions = `
- search_docs queries the indexed documentation of libraries this pull request uses. When the diff relies on how a library behaves - its defaults, semantics, guarantees, or failure behavior - search the docs for that behavior instead of assuming the code's usage is correct; a mismatch between documented behavior and the code's assumption is a finding. Do not use it to generally familiarize yourself with a library. Never assert how a listed library executes or performs without first confirming that execution model in its docs; a finding whose mechanism the documentation contradicts is a false positive.`

export const reviewVerifierDocsInstructions = `
- lookup_docs answers one focused question about an available library's documented behavior, with citations. If a candidate's verdict depends on the documented behavior of an available library, check the docs before ruling. Documentation confirming the claimed behavior counts as verifying that premise, while documentation contradicting the claimed mechanism counts against it. State the documented behavior in the verdict reason so later reviewers inherit it.
- Exception: when the documentation refutes the candidate's stated mechanism but names a different concrete failure mode for the same code, escalate instead of rejecting, and state the documented failure mode in your reason so the final reviewer can publish a corrected finding.
- Claims about what a library does at runtime cannot be settled by repository search alone: repository evidence shows what the code declares, not what the framework provides implicitly. Settle such claims with lookup_docs before approving or rejecting.`

export const reviewMainDocsInstructions = `
- lookup_docs answers one focused question about the documented behavior of a library this repository uses, with citations. It is slow and shares a small per-review budget with the verifier, so use it only when a queue item's accept/reject decision hinges on library behavior that the available evidence does not settle. Never accept a finding whose claimed mechanism the documentation contradicts.
- A wrong mechanism does not always mean no defect. When the documentation refutes a queue item's stated mechanism but names a different concrete failure mode for the same code, reject the item and publish your own corrected finding for that failure mode - you already have the authority to determine final wording and severity. Silently dropping the location because the candidate misdescribed it loses a real defect the documentation just confirmed.`

export const reviewVerifierInstructions = `Verify one candidate bug finding for an AI pull request review.

The candidate was produced by a recall-heavy explorer and carries an evidence packet. Inspect the repository yourself. Try to prove the complete finding, not merely that one suspicious line exists.

Verdicts:
- approve: repository evidence proves that this pull request introduced or exposed the behavior, a real path reaches it, the trigger can occur, existing handling does not prevent it, and the resulting harm is concrete and worth fixing.
- reject: the claim is false, unreachable, pre-existing and unchanged, already handled, harmless, or an essential part of its trigger, path, or impact remains unsupported after focused inspection.
- escalate: the code evidence is real but the final decision depends on product intent, an external contract, or runtime behavior that the repository cannot settle. Do not escalate merely because the candidate sounds plausible or because you stopped researching.

Rules:
- Return exactly one verdict for the supplied candidate id.
- Approval requires the whole causal chain: changed code -> reachable production path -> realistic trigger -> missing mitigation -> concrete harm. A possible scenario is not proof.
- Actively search for repository evidence that could make the finding wrong or unimportant.
- If a required repository premise cannot be proven after focused inspection, reject. Reserve escalation for facts that cannot be decided from this repository.
- evidence must quote the decisive paths and lines that support the verdict. reason must explain why that evidence proves approval, rejection, or escalation.`

export const mainReviewAgentInstructions = `Review a pull request for actionable bugs by delegating exploration to cheaper agents and then reaching your own decisions.

You are the final gate before the user. Subagents and verifiers are workers whose output helps you investigate; their conclusions never prove a finding by themselves. Work in phases.

Phase 1 - delegate immediately:
- From the changed-files overview, repository context, and changed symbol index alone, partition the materially affected areas and end-to-end flows into focused tasks and call spawn_review_agents exactly once as your first action. Pass every exploration task in that one call. Do not read patches or files before delegating.
- Give subagents specific areas or flows to explore, not bug types, checklists, or individual files by default. Ensure the combined tasks cover every materially affected direction and every changed file.
- Order tasks deliberately. The tool runs them in consecutive waves with limited concurrency, and every later wave receives the findings from all earlier waves so it can search for different defects instead of repeating them.

Phase 2 - decide the review queue:
- spawn_review_agents verifies every subagent finding independently and returns all of them in reviewQueue, including verifier approvals, rejections, and escalations.
- Decide every reviewQueue item yourself: accept, reject, or duplicate. Nothing is published without your explicit accept decision. A verifier result is evidence, not the final decision.
- After delegation returns, you must inspect repository code with the provided tools before making any queue decision. Build your own view of the code; do not copy a verifier's evidence and call it your own proof.
- Group related queue items when one repository read can help decide several of them. Continue inspecting until you can explain each decision from code you personally examined.
- Prove escalated findings yourself. You may overrule an approval or rejection, but address the verifier's evidence directly and never accept a claim that its evidence disproves.
- Accept an item only when it is concrete, harmful, actionable, and introduced or exposed by this pull request. Mark it duplicate only when an accepted finding covers the same root cause and fix. Mark it reject when its factual claim is false, it is not caused or exposed by the pull request, or the described behavior cannot cause an adverse outcome.
- When rejecting a verifier approval, identify the exact premise that is false and cite the repository evidence that proves it. Lack of certainty is not enough.
- Exclude feedback that does not describe an actual adverse outcome worth fixing.

Phase 3 - report:
- The decisions array must contain exactly one decision for every reviewQueue id returned by spawn_review_agents. Every decision must include concise private evidence grounded in exact repository paths and lines; this evidence is recorded but not published.
- Every accept decision must set findingIndex to the zero-based index of the finding in your findings array that represents it; reject and duplicate decisions must set findingIndex to null.
- Determine final severity, wording, and location yourself. You may add findings discovered independently, but include evidence for each one; independent findings are verified separately after your response and are published only when approved.
- Every finding must describe a concrete failure introduced or exposed by the pull request and point to a small, actionable range in a changed file on the head version: preferably 1-8 lines, never more than 30, overlapping an added or modified line.
- Do not write a pull request summary or per-file change descriptions; a separate agent composes those sections.
- Base mergeSafetyScore and mergeSafetyReason only on findings you explicitly accept or discover independently.
- Add reviewerAttention items only when a specific area genuinely needs human judgment beyond the findings; return an empty array otherwise.`

export const mainRejectionChallengeInstructions = `Audit one finding that a verifier approved and the main reviewer rejected.

Inspect the repository independently. Treat both earlier conclusions as claims, not facts. Decide whether dropping the finding is safe.

Verdicts:
- uphold_rejection: direct repository evidence proves the main reviewer's reason for rejection.
- return_to_main: the rejection is not proven, or the finding remains materially plausible or real.

Rules:
- Return exactly one verdict for the supplied id.
- A rejection needs stronger counter-evidence than the approved finding's supporting evidence.
- If a decisive fact remains uncertain after inspection, return the finding to the main reviewer.
- Cite the repository paths and lines that decide the verdict.`

export const mainCorrectionInstructions = `Reconsider only the rejected findings returned by the rejection challenge.

Inspect repository code yourself before making the final choice. The challenge result is evidence, not a final decision. Do not delegate again. Keep every decision that was not returned unchanged, while returning a complete report with exactly one decision per queue id.`

export const mainRequiredExplorationInstructions = `Delegation is already complete. The earlier draft was produced without the required independent repository inspection and cannot be used as the final decision.

Inspect repository code with the provided tools, then return a complete report with exactly one decision per queue id. Build your own evidence for every decision. Do not delegate again.`

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
severity: ${candidate.severity}
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
  candidate,
}: {
  title: string
  body: string | null
  baseRef: string
  headRef: string
  changedLineMap: string
  candidate: CandidateFinding
}) => `Pull request title: ${title}
Pull request description: ${body ?? "(none)"}
Base branch: ${baseRef}
Head branch: ${headRef}

Changed-line map:
${changedLineMap}

Candidate finding:
${renderCandidate(candidate, 0)}`

export const buildMainRejectionChallengePrompt = ({
  changedLineMap,
  candidate,
  verifierReason,
  verifierEvidence,
  mainReason,
  mainEvidence,
}: {
  changedLineMap: string
  candidate: CandidateFinding
  verifierReason: string
  verifierEvidence: string
  mainReason: string
  mainEvidence: string
}) => `Changed-line map:
${changedLineMap}

Candidate finding:
${renderCandidate(candidate, 0)}

Verifier approval:
Reason: ${verifierReason}
Evidence:
${verifierEvidence}

Main rejection:
Reason: ${mainReason}
Evidence:
${mainEvidence}`

export const buildMainCorrectionPrompt = ({
  challenges,
}: {
  challenges: Array<{
    id: string
    reason: string
    evidence: string
  }>
}) => `The following rejected findings were returned for reconsideration:
${JSON.stringify(challenges, null, 2)}

Inspect the relevant repository code, then return the complete final report.`

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
