import { useCallback } from "react"
import { toast } from "sonner"
import { Button } from "@workspace/ui/components/button"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { ReviewSettingsFields } from "@/components/repositories/review-settings-fields"
import type {
  ReviewConfigKey,
  ReviewConfigValues,
} from "@/components/repositories/review-settings-fields"
import { useReviewConfig } from "@/hooks/use-review-config"
import { useUpdateReviewConfig } from "@/hooks/use-update-review-config"
import { useUpdateRepository } from "@/hooks/use-update-repository"
import { useWorkspaceReviewConfig } from "@/hooks/use-workspace-review-config"

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
  const { data, isPending, isError, refetch } = useReviewConfig(
    workspaceId,
    repositoryId
  )
  const workspaceConfig = useWorkspaceReviewConfig(workspaceId)
  const updateReviewConfig = useUpdateReviewConfig(workspaceId, repositoryId)
  const updateRepository = useUpdateRepository(workspaceId)
  const settingsDisabled = !canEdit || !repositoryEnabled

  const updateField = useCallback(
    <TKey extends ReviewConfigKey>(
      key: TKey,
      value: ReviewConfigValues[TKey]
    ) => {
      if (settingsDisabled) return
      if (
        key === "baseBranchPatterns" &&
        Array.isArray(value) &&
        value.length === 0
      ) {
        toast.error("At least one base branch is required")
        return
      }

      updateReviewConfig.mutate(
        { [key]: value },
        {
          onError: () => {
            toast.error("Failed to save review settings")
          },
        }
      )
    },
    [settingsDisabled, updateReviewConfig]
  )

  const updateEnabled = useCallback(
    (next: boolean) => {
      if (!canEdit) return
      void updateRepository
        .mutateAsync({ repositoryId, enabled: next })
        .catch(() => toast.error("Failed to update repository"))
    },
    [canEdit, repositoryId, updateRepository]
  )

  if (isPending || workspaceConfig.isPending) {
    return <RepositoryReviewSettingsSkeleton />
  }

  if (isError || workspaceConfig.isError) {
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

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="flex flex-col gap-6">
        {!canEdit ? (
          <div className="rounded-lg border border-border bg-card px-4 py-3 text-xs text-muted-foreground">
            Only workspace admins can change review settings.
          </div>
        ) : null}

        <ReviewSettingsFields
          values={data}
          workspaceDefaults={workspaceConfig.data}
          pendingValues={
            updateReviewConfig.isPending
              ? updateReviewConfig.variables
              : undefined
          }
          disabled={!canEdit}
          onChange={(key, value) => updateField(key, value)}
          repositoryEnabled={repositoryEnabled}
          onRepositoryEnabledChange={updateEnabled}
        />
      </div>
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
