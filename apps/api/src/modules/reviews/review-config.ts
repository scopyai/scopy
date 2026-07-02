import { z } from "zod"

export type ReviewConfigValues = {
  reviewDrafts: boolean
  baseBranchPatterns: string[]
  pathIncludePatterns: string[]
  pathExcludePatterns: string[]
  naturalLanguageRules: string[]
  maxReviewChangedLines: number
}

export type ReviewConfigOverrides = {
  [Key in keyof ReviewConfigValues]: ReviewConfigValues[Key] | null
}

export const defaultWorkspaceReviewConfig: ReviewConfigValues = {
  reviewDrafts: false,
  baseBranchPatterns: ["main", "master"],
  pathIncludePatterns: [],
  pathExcludePatterns: ["**/*.json"],
  naturalLanguageRules: [],
  maxReviewChangedLines: 15_000,
}

const patternSchema = z.string().trim().min(1)
const naturalLanguageRuleSchema = z.string().trim().min(1).max(2_000)
const maxReviewChangedLinesSchema = z.number().int().min(1).max(100_000)

export const workspaceReviewConfigUpdateSchema = z.object({
  reviewDrafts: z.boolean().optional(),
  baseBranchPatterns: z.array(patternSchema).min(1).optional(),
  pathIncludePatterns: z.array(patternSchema).optional(),
  pathExcludePatterns: z.array(patternSchema).optional(),
  naturalLanguageRules: z.array(naturalLanguageRuleSchema).optional(),
  maxReviewChangedLines: maxReviewChangedLinesSchema.optional(),
})

export const repositoryReviewConfigUpdateSchema = z.object({
  reviewDrafts: z.boolean().optional(),
  baseBranchPatterns: z.array(patternSchema).min(1).optional(),
  pathIncludePatterns: z.array(patternSchema).optional(),
  pathExcludePatterns: z.array(patternSchema).optional(),
  naturalLanguageRules: z.array(naturalLanguageRuleSchema).optional(),
  maxReviewChangedLines: maxReviewChangedLinesSchema.optional(),
})

export const resolveReviewConfig = (
  workspaceDefaults: ReviewConfigValues | null | undefined,
  repositoryOverrides: ReviewConfigOverrides | null | undefined
): ReviewConfigValues => {
  const defaults = workspaceDefaults ?? defaultWorkspaceReviewConfig

  return {
    reviewDrafts: repositoryOverrides?.reviewDrafts ?? defaults.reviewDrafts,
    baseBranchPatterns:
      repositoryOverrides?.baseBranchPatterns ?? defaults.baseBranchPatterns,
    pathIncludePatterns:
      repositoryOverrides?.pathIncludePatterns ?? defaults.pathIncludePatterns,
    pathExcludePatterns:
      repositoryOverrides?.pathExcludePatterns ?? defaults.pathExcludePatterns,
    naturalLanguageRules:
      repositoryOverrides?.naturalLanguageRules ??
      defaults.naturalLanguageRules,
    maxReviewChangedLines:
      repositoryOverrides?.maxReviewChangedLines ??
      defaults.maxReviewChangedLines,
  }
}

export const hasReviewConfigOverrides = (overrides: ReviewConfigOverrides) =>
  Object.values(overrides).some((value) => value !== null)

const valuesEqual = <TValue>(left: TValue, right: TValue) =>
  Array.isArray(left) && Array.isArray(right)
    ? left.length === right.length &&
      left.every((value, index) => value === right[index])
    : left === right

export const normalizeReviewConfigOverrides = (
  workspaceDefaults: ReviewConfigValues,
  overrides: ReviewConfigOverrides
): ReviewConfigOverrides => ({
  reviewDrafts:
    overrides.reviewDrafts !== null &&
    valuesEqual(overrides.reviewDrafts, workspaceDefaults.reviewDrafts)
      ? null
      : overrides.reviewDrafts,
  baseBranchPatterns:
    overrides.baseBranchPatterns !== null &&
    valuesEqual(
      overrides.baseBranchPatterns,
      workspaceDefaults.baseBranchPatterns
    )
      ? null
      : overrides.baseBranchPatterns,
  pathIncludePatterns:
    overrides.pathIncludePatterns !== null &&
    valuesEqual(
      overrides.pathIncludePatterns,
      workspaceDefaults.pathIncludePatterns
    )
      ? null
      : overrides.pathIncludePatterns,
  pathExcludePatterns:
    overrides.pathExcludePatterns !== null &&
    valuesEqual(
      overrides.pathExcludePatterns,
      workspaceDefaults.pathExcludePatterns
    )
      ? null
      : overrides.pathExcludePatterns,
  naturalLanguageRules:
    overrides.naturalLanguageRules !== null &&
    valuesEqual(
      overrides.naturalLanguageRules,
      workspaceDefaults.naturalLanguageRules
    )
      ? null
      : overrides.naturalLanguageRules,
  maxReviewChangedLines:
    overrides.maxReviewChangedLines !== null &&
    valuesEqual(
      overrides.maxReviewChangedLines,
      workspaceDefaults.maxReviewChangedLines
    )
      ? null
      : overrides.maxReviewChangedLines,
})

export type ReviewBillingMode = "platform" | "byok"

export const matchesBranchPattern = (branch: string, pattern: string) => {
  const expression = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")

  return new RegExp(`^${expression}$`).test(branch)
}

export const shouldRunAutomaticReview = ({
  config,
  draft,
  baseRef,
}: {
  config: ReviewConfigValues
  draft: boolean
  baseRef: string
}) =>
  (config.reviewDrafts || !draft) &&
  config.baseBranchPatterns.some((pattern) =>
    matchesBranchPattern(baseRef, pattern)
  )

export const selectReviewTrigger = ({
  isAutomatic,
  isMention,
  config,
  draft,
  baseRef,
}: {
  isAutomatic: boolean
  isMention: boolean
  config: ReviewConfigValues
  draft: boolean
  baseRef: string
}): "automatic" | "mention" | null => {
  if (isMention) return "mention"
  if (!isAutomatic) return null

  return shouldRunAutomaticReview({ config, draft, baseRef })
    ? "automatic"
    : null
}
