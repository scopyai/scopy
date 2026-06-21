import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { AlertCircleIcon } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Label } from "@workspace/ui/components/label"
import { Separator } from "@workspace/ui/components/separator"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { Switch } from "@workspace/ui/components/switch"
import { PatternListInput } from "@/components/repositories/pattern-list-input"
import { NaturalLanguageLinterPanel } from "@/components/repositories/natural-language-linter-panel"
import { SettingsSection } from "@/components/repositories/settings-section"
import {
  useUpdateReviewConfig,
  type ReviewConfigUpdate,
} from "@/hooks/use-update-review-config"
import { useReviewConfig } from "@/hooks/use-review-config"

type ReviewConfigForm = {
  reviewPullRequests: boolean
  reviewDrafts: boolean
  baseBranchPatterns: string[]
  pathIncludePatterns: string[]
  pathExcludePatterns: string[]
}

const defaultReviewConfigForm = (): ReviewConfigForm => ({
  reviewPullRequests: true,
  reviewDrafts: false,
  baseBranchPatterns: ["main", "master"],
  pathIncludePatterns: [],
  pathExcludePatterns: [],
})

const toFormValues = (
  config: Awaited<ReturnType<typeof useReviewConfig>>["data"],
): ReviewConfigForm => ({
  reviewPullRequests: config?.reviewPullRequests ?? true,
  reviewDrafts: config?.reviewDrafts ?? false,
  baseBranchPatterns: config?.baseBranchPatterns ?? ["main", "master"],
  pathIncludePatterns: config?.pathIncludePatterns ?? [],
  pathExcludePatterns: config?.pathExcludePatterns ?? [],
})

const toPayload = (form: ReviewConfigForm): ReviewConfigUpdate => ({
  enabled: form.reviewPullRequests,
  reviewPullRequests: form.reviewPullRequests,
  reviewDrafts: form.reviewDrafts,
  baseBranchPatterns: form.baseBranchPatterns,
  pathIncludePatterns: form.pathIncludePatterns,
  pathExcludePatterns: form.pathExcludePatterns,
})

interface RepositoryReviewSettingsProps {
  workspaceId: string
  repositoryId: string
  repositoryEnabled: boolean
  canEdit: boolean
}

export function RepositoryReviewSettings({
  workspaceId,
  repositoryId,
  repositoryEnabled,
  canEdit,
}: RepositoryReviewSettingsProps) {
  const { data: reviewConfig, isPending, isError, refetch } = useReviewConfig(
    workspaceId,
    repositoryId,
  )
  const updateReviewConfig = useUpdateReviewConfig(workspaceId, repositoryId)

  const serverValues = useMemo(
    () => toFormValues(reviewConfig),
    [reviewConfig],
  )
  const serverValuesKey = useMemo(
    () => JSON.stringify(serverValues),
    [serverValues],
  )
  const [form, setForm] = useState<ReviewConfigForm>(defaultReviewConfigForm)
  const formRef = useRef(form)
  formRef.current = form

  useEffect(() => {
    setForm((current) => {
      const next = JSON.parse(serverValuesKey) as ReviewConfigForm
      return JSON.stringify(current) === serverValuesKey ? current : next
    })
  }, [serverValuesKey])

  const readOnly = !canEdit
  const settingsDisabled = readOnly || !repositoryEnabled

  const saveConfig = useCallback(
    async (next: ReviewConfigForm) => {
      if (settingsDisabled) return

      if (next.baseBranchPatterns.length === 0) {
        toast.error("At least one base branch is required")
        setForm(serverValues)
        return
      }

      setForm(next)

      try {
        await updateReviewConfig.mutateAsync(toPayload(next))
      } catch {
        toast.error("Failed to save review settings")
        setForm(serverValues)
      }
    },
    [settingsDisabled, serverValues, updateReviewConfig],
  )

  const patchConfig = useCallback(
    (patch: Partial<ReviewConfigForm>) => {
      void saveConfig({ ...formRef.current, ...patch })
    },
    [saveConfig],
  )

  if (isPending && reviewConfig === undefined) {
    return <RepositoryReviewSettingsSkeleton />
  }

  if (isError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm text-muted-foreground">
          Failed to load review settings.
        </p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          Try again
        </Button>
      </div>
    )
  }

  const scopeDisabled = settingsDisabled || !form.reviewPullRequests

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="flex flex-col gap-6">
        {!repositoryEnabled ? (
          <div className="flex items-start gap-3 rounded-lg border border-border bg-card px-4 py-3">
            <AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium">Repository tracking is disabled</p>
              <p className="text-xs text-muted-foreground">
                Enable this repository from the repositories list before reviews
                can run.
              </p>
            </div>
          </div>
        ) : null}

        {readOnly ? (
          <div className="rounded-lg border border-border bg-card px-4 py-3 text-xs text-muted-foreground">
            Only workspace admins can change review settings.
          </div>
        ) : null}

        <SettingsSection
          title="Automatic reviews"
          description="Control when Scopy analyzes pull requests for this repository."
        >
          <SettingRow
            id="review-pull-requests"
            label="Review pull requests"
            description="Run reviews when PRs are opened, marked ready, or when you mention the GitHub App."
            checked={form.reviewPullRequests}
            onCheckedChange={(checked) =>
              patchConfig({ reviewPullRequests: checked })
            }
            disabled={settingsDisabled}
          />
          <Separator />
          <SettingRow
            id="review-drafts"
            label="Review draft pull requests"
            description="Include draft PRs in automatic reviews. Mention triggers always work."
            checked={form.reviewDrafts}
            onCheckedChange={(checked) => patchConfig({ reviewDrafts: checked })}
            disabled={scopeDisabled}
          />
        </SettingsSection>

        <SettingsSection
          title="Scope"
          description="Limit which branches and files Scopy includes in a review."
        >
          <PatternListInput
            id="base-branch-patterns"
            label="Base branches"
            description='Only review PRs targeting these branches. Supports globs like "release/*".'
            placeholder="main"
            values={form.baseBranchPatterns}
            onChange={(baseBranchPatterns) => patchConfig({ baseBranchPatterns })}
            disabled={scopeDisabled}
          />
          <Separator />
          <PatternListInput
            id="path-include-patterns"
            label="Include paths"
            description="If set, only changed files matching these patterns are reviewed."
            placeholder="apps/api/**"
            values={form.pathIncludePatterns}
            onChange={(pathIncludePatterns) =>
              patchConfig({ pathIncludePatterns })
            }
            disabled={scopeDisabled}
          />
          <Separator />
          <PatternListInput
            id="path-exclude-patterns"
            label="Exclude paths"
            description="Skip changed files matching these patterns."
            placeholder="**/*.lock"
            values={form.pathExcludePatterns}
            onChange={(pathExcludePatterns) =>
              patchConfig({ pathExcludePatterns })
            }
            disabled={scopeDisabled}
          />
        </SettingsSection>

        <NaturalLanguageLinterPanel
          workspaceId={workspaceId}
          repositoryId={repositoryId}
          disabled={scopeDisabled}
        />
      </div>
    </div>
  )
}

function SettingRow({
  id,
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
}: {
  id: string
  label: string
  description: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col gap-1">
        <Label htmlFor={id}>{label}</Label>
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

function RepositoryReviewSettingsSkeleton() {
  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="flex flex-col gap-6">
        <Skeleton className="h-32 w-full rounded-lg" />
        <Skeleton className="h-80 w-full rounded-lg" />
        <Skeleton className="h-96 w-full rounded-lg" />
      </div>
    </div>
  )
}
