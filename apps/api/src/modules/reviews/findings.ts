import {
  severityRank,
  type CandidateFinding,
  type ReviewFinding,
} from "./prompt"

type Range = { file: string; startLine: number; endLine: number }

const overlaps = (first: Range, second: Range) =>
  first.file === second.file &&
  first.startLine <= second.endLine &&
  second.startLine <= first.endLine

const meaningfulTokens = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 2)
      .map((token) =>
        token.length > 3 && token.endsWith("s") ? token.slice(0, -1) : token
      )
  )

const tokenOverlapScore = (first: Set<string>, second: Set<string>) => {
  if (first.size === 0 || second.size === 0) return 0
  const shared = [...first].filter((token) => second.has(token)).length
  return shared / Math.min(first.size, second.size)
}

const findingTokens = (finding: Pick<ReviewFinding, "title" | "body">) =>
  new Set([
    ...meaningfulTokens(finding.title),
    ...meaningfulTokens(finding.body),
  ])

const SAME_ISSUE_TOKEN_OVERLAP = 0.4
const NEAR_IDENTICAL_RANGE_JACCARD = 0.6
const NEAR_IDENTICAL_TOKEN_OVERLAP = 0.3

const rangeJaccard = (first: Range, second: Range) => {
  const intersection =
    Math.min(first.endLine, second.endLine) -
    Math.max(first.startLine, second.startLine) +
    1
  if (intersection <= 0) return 0
  const union =
    Math.max(first.endLine, second.endLine) -
    Math.min(first.startLine, second.startLine) +
    1
  return intersection / union
}

const sameIssue = (
  first: ReviewFinding,
  firstTokens: Set<string>,
  second: ReviewFinding,
  secondTokens: Set<string>
) => {
  if (!overlaps(first, second)) return false
  const score = tokenOverlapScore(firstTokens, secondTokens)
  return (
    score >= SAME_ISSUE_TOKEN_OVERLAP ||
    (score >= NEAR_IDENTICAL_TOKEN_OVERLAP &&
      rangeJaccard(first, second) >= NEAR_IDENTICAL_RANGE_JACCARD)
  )
}

const preferredCandidate = (
  first: CandidateFinding,
  second: CandidateFinding
) =>
  severityRank[first.severity] - severityRank[second.severity] ||
  second.confidence - first.confidence ||
  second.evidence.length - first.evidence.length

export const mergeOverlappingCandidates = (
  candidates: CandidateFinding[],
  options: {
    isAnchorable?: (candidate: CandidateFinding) => boolean
  } = {}
): { merged: CandidateFinding[]; duplicates: CandidateFinding[] } => {
  const groups: Array<
    Array<{ candidate: CandidateFinding; tokens: Set<string> }>
  > = []
  for (const candidate of candidates) {
    const tokens = findingTokens(candidate)
    const group = groups.find((entry) =>
      entry.some((item) =>
        sameIssue(item.candidate, item.tokens, candidate, tokens)
      )
    )
    if (group) group.push({ candidate, tokens })
    else groups.push([{ candidate, tokens }])
  }

  const merged: CandidateFinding[] = []
  const duplicates: CandidateFinding[] = []
  const { isAnchorable } = options
  for (const group of groups) {
    const [representative, ...rest] = group
      .map((item) => item.candidate)
      .sort(
        isAnchorable
          ? (first, second) =>
              Number(isAnchorable(second)) - Number(isAnchorable(first)) ||
              preferredCandidate(first, second)
          : preferredCandidate
      )
    merged.push({
      ...representative!,
      supportingTaskIds: [
        ...new Set(group.map((item) => item.candidate.taskId)),
      ],
    })
    duplicates.push(...rest)
  }
  return { merged, duplicates }
}

export const isSameIssue = (first: ReviewFinding, second: ReviewFinding) =>
  sameIssue(first, findingTokens(first), second, findingTokens(second))

export const resemblesSameIssue = (
  first: ReviewFinding,
  second: ReviewFinding
) =>
  isSameIssue(first, second) ||
  tokenOverlapScore(findingTokens(first), findingTokens(second)) >=
    SAME_ISSUE_TOKEN_OVERLAP

export const dedupeSameIssueFindings = <T extends ReviewFinding>(
  findings: T[]
): T[] => {
  const kept: T[] = []
  for (const finding of findings) {
    if (!kept.some((existing) => isSameIssue(existing, finding))) {
      kept.push(finding)
    }
  }
  return kept
}

export const dropFindingsCoveredBy = (
  findings: ReviewFinding[],
  coveringFindings: ReviewFinding[]
) =>
  findings.filter(
    (finding) =>
      !coveringFindings.some((covering) => isSameIssue(finding, covering))
  )

export const sortBySeverity = <
  T extends { severity: ReviewFinding["severity"] },
>(
  findings: T[]
) =>
  findings
    .map((finding, order) => ({ finding, order }))
    .sort(
      (first, second) =>
        severityRank[first.finding.severity] -
          severityRank[second.finding.severity] || first.order - second.order
    )
    .map((entry) => entry.finding)
