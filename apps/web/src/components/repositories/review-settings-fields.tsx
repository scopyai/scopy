import { Badge } from "@workspace/ui/components/badge"
import { Separator } from "@workspace/ui/components/separator"
import { Switch } from "@workspace/ui/components/switch"
import { NaturalLanguageLinterPanel } from "@/components/repositories/natural-language-linter-panel"
import { PatternListInput } from "@/components/repositories/pattern-list-input"
import { MaxReviewChangedLinesInput } from "@/components/repositories/max-review-changed-lines-input"
import { SettingLabelRow } from "@/components/repositories/setting-label-row"
import { SettingsSection } from "@/components/repositories/settings-section"
import { tagToneClassName } from "@/lib/tag-tones"

export type ReviewConfigValues = {
  reviewDrafts: boolean
  baseBranchPatterns: string[]
  pathIncludePatterns: string[]
  pathExcludePatterns: string[]
  naturalLanguageRules: string[]
  maxReviewChangedLines: number
}

export type ReviewConfigKey = keyof ReviewConfigValues
interface ReviewSettingsFieldsProps {
  values: ReviewConfigValues
  disabled: boolean
  pendingValues?: Partial<ReviewConfigValues>
  onChange: <TKey extends ReviewConfigKey>(
    key: TKey,
    value: ReviewConfigValues[TKey]
  ) => void
  workspaceDefaults?: ReviewConfigValues
  repositoryEnabled?: boolean
  onRepositoryEnabledChange?: (enabled: boolean) => void
}

export function ReviewSettingsFields({
  values,
  disabled,
  pendingValues,
  onChange,
  workspaceDefaults,
  repositoryEnabled,
  onRepositoryEnabledChange,
}: ReviewSettingsFieldsProps) {
  const automaticReviewsDisabled = disabled || repositoryEnabled === false
  const controlDisabled = (dependent = false) =>
    disabled || (dependent && automaticReviewsDisabled)

  const effectiveValue = <TKey extends ReviewConfigKey>(key: TKey) =>
    resolveConfigValue(key, values, pendingValues)

  const scopeBadge = (key: ReviewConfigKey) => {
    if (workspaceDefaults === undefined) return undefined
    const inherited = reviewConfigValuesEqual(
      effectiveValue(key),
      workspaceDefaults[key]
    )
    return <ScopeBadge visible={inherited} />
  }

  return (
    <div className="flex flex-col gap-6">
      <SettingsSection
        title="Automatic reviews"
        description="Control when Scopy analyzes pull requests. Explicit app mentions remain available."
      >
        {repositoryEnabled !== undefined && onRepositoryEnabledChange ? (
          <>
            <SettingRow
              id="repository-enabled"
              label="Enable reviews"
              description="Allow automatic reviews and explicit app mentions for this repository."
              checked={repositoryEnabled}
              onCheckedChange={onRepositoryEnabledChange}
              disabled={disabled}
            />
            <Separator />
          </>
        ) : null}
        <SettingRow
          id="review-drafts"
          label="Review draft pull requests"
          description="Include drafts in automatic reviews. Explicit app mentions always work."
          checked={effectiveValue("reviewDrafts")}
          onCheckedChange={(value) => onChange("reviewDrafts", value)}
          disabled={controlDisabled(true)}
          scopeBadge={scopeBadge("reviewDrafts")}
        />
      </SettingsSection>

      <SettingsSection
        title="Scope"
        description="Limit which branches and files Scopy includes in a review."
      >
        <PatternListInput
          id="base-branch-patterns"
          label="Base branches"
          description='Only review pull requests targeting these branches. Supports globs like "release/*".'
          placeholder="main"
          values={effectiveValue("baseBranchPatterns")}
          onChange={(value) => onChange("baseBranchPatterns", value)}
          disabled={controlDisabled(true)}
          scopeBadge={scopeBadge("baseBranchPatterns")}
        />
        <Separator />
        <PatternListInput
          id="path-include-patterns"
          label="Include paths"
          description="If set, only changed files matching these patterns are reviewed."
          placeholder="apps/api/**"
          values={effectiveValue("pathIncludePatterns")}
          onChange={(value) => onChange("pathIncludePatterns", value)}
          disabled={controlDisabled(true)}
          scopeBadge={scopeBadge("pathIncludePatterns")}
        />
        <Separator />
        <PatternListInput
          id="path-exclude-patterns"
          label="Exclude paths"
          description="Skip changed files matching these patterns. Exclusions take precedence."
          placeholder="**/*.lock"
          values={effectiveValue("pathExcludePatterns")}
          onChange={(value) => onChange("pathExcludePatterns", value)}
          disabled={controlDisabled(true)}
          scopeBadge={scopeBadge("pathExcludePatterns")}
        />
        <Separator />
        <MaxReviewChangedLinesInput
          id="max-review-changed-lines"
          value={effectiveValue("maxReviewChangedLines")}
          onChange={(value) => onChange("maxReviewChangedLines", value)}
          disabled={controlDisabled(true)}
          scopeBadge={scopeBadge("maxReviewChangedLines")}
        />
      </SettingsSection>

      <NaturalLanguageLinterPanel
        rules={effectiveValue("naturalLanguageRules")}
        onChange={(value) => onChange("naturalLanguageRules", value)}
        disabled={controlDisabled(true)}
      />
    </div>
  )
}

function resolveConfigValue<TKey extends ReviewConfigKey>(
  key: TKey,
  values: ReviewConfigValues,
  pendingValues?: Partial<ReviewConfigValues>
): ReviewConfigValues[TKey] {
  if (pendingValues && pendingValues[key] !== undefined) {
    return pendingValues[key] as ReviewConfigValues[TKey]
  }

  return values[key]
}

function reviewConfigValuesEqual(
  left: ReviewConfigValues[ReviewConfigKey],
  right: ReviewConfigValues[ReviewConfigKey]
) {
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((value, index) => value === right[index])
    )
  }

  return left === right
}

function ScopeBadge({ visible }: { visible: boolean }) {
  if (!visible) return null

  return (
    <Badge
      variant="outline"
      className={tagToneClassName(
        "default",
        "h-5 px-1.5 text-[10px] leading-none"
      )}
    >
      Workspace default
    </Badge>
  )
}

export { SettingLabelRow } from "@/components/repositories/setting-label-row"

function SettingRow({
  id,
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
  scopeBadge,
}: {
  id: string
  label: string
  description: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  scopeBadge?: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col gap-1">
        <SettingLabelRow htmlFor={id} label={label} scopeBadge={scopeBadge} />
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        className="mt-0.5 shrink-0"
      />
    </div>
  )
}
