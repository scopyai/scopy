import { useCallback } from "react"
import { InfoIcon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@workspace/ui/components/button"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { ReviewSettingsFields } from "@/components/repositories/review-settings-fields"
import type {
  ReviewConfigKey,
  ReviewConfigValues,
} from "@/components/repositories/review-settings-fields"
import { useWorkspaceReviewConfig } from "@/hooks/use-workspace-review-config"
import { useUpdateWorkspaceReviewConfig } from "@/hooks/use-update-workspace-review-config"

export function WorkspaceReviewSettings({
  workspaceId,
  canEdit,
}: {
  workspaceId: string
  canEdit: boolean
}) {
  const { data, isPending, isError, refetch } =
    useWorkspaceReviewConfig(workspaceId)
  const updateConfig = useUpdateWorkspaceReviewConfig(workspaceId)

  const updateField = useCallback(
    <TKey extends ReviewConfigKey>(
      key: TKey,
      value: ReviewConfigValues[TKey]
    ) => {
      if (!canEdit) return
      if (
        key === "baseBranchPatterns" &&
        Array.isArray(value) &&
        value.length === 0
      ) {
        toast.error("At least one base branch is required")
        return
      }

      updateConfig.mutate(
        { [key]: value },
        {
          onError: () => {
            toast.error("Failed to save workspace review settings")
          },
        }
      )
    },
    [canEdit, updateConfig]
  )

  if (isPending) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-64 w-full rounded-lg" />
        <Skeleton className="h-96 w-full rounded-lg" />
      </div>
    )
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
        <p className="text-sm text-muted-foreground">
          Failed to load workspace review settings.
        </p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          Try again
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2">
        <InfoIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">
          Set workspace defaults for all repositories. Per-repo settings can
          override these defaults when values different from these are set.
        </p>
      </div>

      {!canEdit ? (
        <div className="rounded-lg border border-border bg-card px-4 py-3 text-xs text-muted-foreground">
          Only workspace admins can change review settings.
        </div>
      ) : null}

      <ReviewSettingsFields
        values={data}
        pendingValues={
          updateConfig.isPending ? updateConfig.variables : undefined
        }
        disabled={!canEdit}
        onChange={(key, value) => updateField(key, value)}
      />
    </div>
  )
}
