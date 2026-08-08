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

export const codeLocationSchema = z.object({
  file: z.string().min(1),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
})

export const candidateFindingSchema = reviewFindingSchema
  .omit({ severity: true })
  .extend({
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

export const reviewVerifierVerdictSchema = z
  .object({
    id: z.string().min(1),
    verdict: z.enum(["accept", "reject", "escalate"]),
    rootCause: z.string(),
    failurePath: z.string(),
    usefulness: z.string(),
    contradiction: z.string(),
    unresolvedQuestion: z.string(),
    knownFacts: z.string(),
    locations: z.array(codeLocationSchema),
  })
  .superRefine((output, validation) => {
    const requireText = (field: keyof typeof output, value: string) => {
      if (value.trim().length === 0) {
        validation.addIssue({
          code: "custom",
          path: [field],
          message: `${field} is required for verdict ${output.verdict}.`,
        })
      }
    }
    if (output.verdict === "accept") {
      requireText("rootCause", output.rootCause)
      requireText("failurePath", output.failurePath)
      requireText("usefulness", output.usefulness)
      if (output.locations.length === 0) {
        validation.addIssue({
          code: "custom",
          path: ["locations"],
          message: "Accepted findings require at least one code location.",
        })
      }
    } else if (output.verdict === "reject") {
      requireText("contradiction", output.contradiction)
      if (output.locations.length === 0) {
        validation.addIssue({
          code: "custom",
          path: ["locations"],
          message: "Rejected findings require at least one code location.",
        })
      }
    } else {
      requireText("unresolvedQuestion", output.unresolvedQuestion)
      requireText("knownFacts", output.knownFacts)
    }
  })

export const reviewVerifierOutputSchema = reviewVerifierVerdictSchema

export const reviewDecisionSchema = z
  .object({
    id: z.string().min(1),
    decision: z.enum(["accept", "reject"]),
    findingIndex: z.number().int().nonnegative().nullable(),
    rootCause: z.string(),
    failurePath: z.string(),
    failedCondition: z.string(),
    checkedLocations: z.array(codeLocationSchema).min(1),
  })
  .superRefine((output, validation) => {
    const requireText = (field: keyof typeof output, value: string) => {
      if (value.trim().length === 0) {
        validation.addIssue({
          code: "custom",
          path: [field],
          message: `${field} is required for decision ${output.decision}.`,
        })
      }
    }
    if (output.decision === "accept") {
      if (output.findingIndex === null) {
        validation.addIssue({
          code: "custom",
          path: ["findingIndex"],
          message: "Accepted candidates require a findingIndex.",
        })
      }
      requireText("rootCause", output.rootCause)
      requireText("failurePath", output.failurePath)
    } else {
      if (output.findingIndex !== null) {
        validation.addIssue({
          code: "custom",
          path: ["findingIndex"],
          message: "Rejected candidates must use a null findingIndex.",
        })
      }
      requireText("failedCondition", output.failedCondition)
    }
  })

export const mainFindingSchema = reviewFindingSchema.extend({
  sourceCandidateIds: z.array(z.string().min(1)).min(1),
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
- The assigned area is only a starting location. It does not limit which defects you may report. Report any distinct problem you encounter in the changed code or its connected behavior.
- Do not apply the final publication standard. Changed tests, fixtures, scripts, configuration, migrations, and other support code are review targets too. Report defects in them when they can break their purpose or leave incorrect state.
- Report uncertain and incomplete possibilities. Do not discard a possibility because it is difficult to prove, seems unlikely, has limited impact, or shares a location with another finding.
- A file, function, line, or call site can contain several independent defects. Finding one defect there does not make that code covered or safe. Continue exploring it for different defects.
- Findings are the same bug only when they have the same underlying cause and one semantic code fix would resolve them together. Report that bug once. Report different causes separately, even when they share the same location.
- If the prompt lists already reported findings, do not re-report them or variants sharing their root cause. They are handled; your value is in what they miss. The files they live in are proven bug-dense, so re-inspect those files for different defects instead of avoiding them.
- Read every changed file in your assigned area with read_file. The diff in the prompt is an overview, not a substitute for reading the file.
- For each changed operation in your assigned area, trace the concrete runtime call path. Do not assume it is correct only because nearby code uses the same pattern. If the concrete receiver or effect remains unresolved, report that uncertainty as a hypothesis instead of silently treating the operation as safe.
- Inspect as much relevant code as needed to understand the change and its effects.
- Explore the assigned area evenly. Do not conclude it is clean while any part remains uninspected.
- Finding one issue is not a stopping condition. Continue searching for distinct issues until you have fully explored the assigned area.
- Make several fresh passes over the area. In each pass, challenge your earlier view and look for paths or assumptions you have not considered yet.
- For each finding return the most relevant repository-relative file, head-side start and end lines overlapping a changed line, a short title, and a body explaining what goes wrong and in what scenario. Keep the line range small and actionable: preferably 1-8 lines, never more than 30. Ranges that cannot be anchored to the diff are discarded.
- evidence is the strongest starting evidence you found, with repository-relative paths and line numbers. It is a lead for later agents, not proof. If the hypothesis remains uncertain, state the exact unresolved fact.
- Return an empty findings array only after thoroughly exploring the assigned area and finding no plausible failure.`

export const reviewChangedFileCoverageInstructions = `

Changed-file coverage:
- Ensure every non-generated changed file is read by at least one discovery subagent.
- Each spawn_review_agents result includes uncoveredFiles. If it is not empty, launch more discovery tasks for those files before returning the final report.
- Uncovered changed files take priority. You may also use follow-up tasks to investigate existing candidates.
- Do not return the final report while uncoveredFiles is not empty.`

export const reviewSubagentDocsInstructions = `
- search_docs queries the indexed documentation of libraries this pull request uses. When the diff relies on how a library behaves - its defaults, semantics, guarantees, or failure behavior - search the docs for that behavior instead of assuming the code's usage is correct; a mismatch between documented behavior and the code's assumption is a finding. Do not use it to generally familiarize yourself with a library. Never assert how a listed library executes or performs without first confirming that execution model in its docs; a finding whose mechanism the documentation contradicts is a false positive.`

export const reviewVerifierDocsInstructions = `
- lookup_docs answers one focused question about an available library's documented behavior, with citations. If a verdict depends on that behavior, check the docs before ruling. Documentation can confirm or contradict a required premise. Include the decisive documented fact in your structured result.
- If documentation refutes the stated mechanism but identifies a different concrete failure at the same code, escalate and state the unresolved corrected claim.
- Claims about library runtime behavior cannot be settled by repository search alone. Settle them with lookup_docs before accepting or rejecting.`

export const reviewMainDocsInstructions = `
- lookup_docs answers one focused question about the documented behavior of a library this repository uses, with citations. It is slow and shares a small per-review budget with the verifier, so use it only when a queue item's accept/reject decision hinges on library behavior that the available evidence does not settle. Never accept a finding whose claimed mechanism the documentation contradicts.
- A wrong mechanism does not always mean no defect. When documentation refutes a candidate but identifies a different concrete failure at the same code, reject that candidate and send a focused follow-up task through spawn_review_agents. Do not silently drop the newly identified possibility.`

export const reviewVerifierInstructions = `Verify one candidate bug finding. Inspect the repository yourself. The candidate evidence is only a lead.

Use this process:
1. Identify the exact claim.
2. Find the changed code that causes or exposes it.
3. Trace the path from that code to the reported result.
4. Confirm that the trigger can occur.
5. Search for code that prevents or contradicts the claim.
6. Decide if the result is harmful and worth fixing.

Usefulness criteria for accept:
- A supported caller can reach the trigger with valid input.
- The result has a concrete effect that a user or maintainer would care about.
- Fixing it is justified by that effect, not only by a theoretical possibility.

Verdicts:
- accept: you found the root cause and proved a reachable path to a concrete adverse result that this pull request introduces or exposes. State briefly in usefulness who is affected, what happens, and why it is worth fixing.
- reject: you found explicit code that contradicts an essential part of the claim. Give the contradiction and its exact location. Failure to find proof is not enough for rejection.
- escalate: you found relevant facts but cannot prove the full claim and cannot disprove it. State the exact unresolved question. Use this when the answer depends on product intent, an external contract, or runtime behavior that available evidence cannot settle.

Return exactly one verdict for the supplied candidate id. Keep the result concise. Always return every output field. Use an empty string for text fields that do not apply to the selected verdict.`

export const mainReviewAgentInstructions = `Review a pull request for actionable bugs. You are the final gate before the user.

Phase 1 - understand the change:
- Read the diff and inspect connected repository code before launching subagents.
- Build your own view of the changed flows. Use that view to create focused exploration tasks.

Phase 2 - discover:
- Call spawn_review_agents with tasks that cover every materially affected area.
- For each task, set only the area to explore. The area can name a changed flow, component, or connected code surface. Do not put bug types, review instructions, expected depth, proof requirements, output requirements, or desired findings in it.
- An assigned area is a starting location, not a boundary. Discovery agents remain responsible for every distinct defect they encounter, including defects in changed tests and support code.
- Tasks run one at a time. Each later task receives a compact list of earlier findings and must search for different defects.
- The tool returns every candidate with a lightweight verifier verdict. The verifier's private proof is not shown to you. A verdict is a worker opinion, not a fact.
- If a returned candidate shows that discovery missed a related area, call spawn_review_agents again with focused follow-up tasks. Do not create a new finding yourself. Send discovery work through subagents.

Phase 3 - decide:
- Use the same process for every candidate: identify the claim, trace the changed code to its result, confirm the trigger, search for prevention or contradiction, and decide if the result is harmful and worth fixing.
- Inspect the code yourself. A candidate lead and verifier verdict cannot serve as your proof.
- Return accept or reject for every candidate from every spawn_review_agents call.
- Accept only when you independently prove a concrete, actionable adverse result introduced or exposed by the pull request.
- Reject when an essential condition is false, not caused or exposed by the change, prevented by existing code, unreachable, or unable to cause a meaningful adverse result. State the failed condition.
- Decide escalated items yourself. Treat verifier accepts and rejects in the same independent way.
- Merge duplicates by mapping several accepted candidate ids to the same final finding. Do not return a duplicate decision.

Phase 4 - report:
- Every decision must cite checkedLocations from code that you personally read.
- Every accepted decision points to the final finding that represents it. Every final finding lists all sourceCandidateIds that it represents.
- Always return every decision field. For accept, set failedCondition to an empty string. For reject, set findingIndex to null and set rootCause and failurePath to empty strings.
- You assign final severity, wording, and location. Discovery agents do not assign severity.
- Do not add a finding with no source candidate. If you notice a missed issue, launch a follow-up discovery task before reporting.
- Every final finding must point to a small changed line range: preferably 1-8 lines, never more than 30.
- Do not write a pull request summary or per-file change descriptions. A separate agent does that.
- Base mergeSafetyScore and mergeSafetyReason only on accepted findings.
- Add reviewerAttention only when a specific area needs human judgment beyond the findings.`

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
file: ${candidate.file}
range: ${candidate.startLine}-${candidate.endLine}
title: ${candidate.title}
claim: ${candidate.body}
lead from discovery:
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
