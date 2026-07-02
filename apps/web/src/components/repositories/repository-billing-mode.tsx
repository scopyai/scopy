import { toast } from "sonner"
import { Separator } from "@workspace/ui/components/separator"
import { RadioOption } from "@/components/radio-option"
import { SettingsSection } from "@/components/repositories/settings-section"
import { useRepositories } from "@/hooks/use-repositories"
import {
  useProviderKeys,
  useSetRepositoryBillingMode,
  useSetRepositoryByokProvider,
  type ProviderKeyProvider,
  type ReviewBillingMode,
} from "@/hooks/use-provider-keys"

const PROVIDER_LABELS: Record<ProviderKeyProvider, string> = {
  openrouter: "OpenRouter",
  gateway: "Vercel AI Gateway",
}

const modeLabel = (mode: ReviewBillingMode) =>
  mode === "byok" ? "Bring your own key" : "Platform billing"

export function RepositoryBillingMode({
  workspaceId,
  repositoryId,
  disabled,
}: {
  workspaceId: string
  repositoryId: string
  disabled: boolean
}) {
  const { data: repositories } = useRepositories(workspaceId)
  const { data: providerKeys } = useProviderKeys(workspaceId)
  const setMode = useSetRepositoryBillingMode(workspaceId)
  const setProvider = useSetRepositoryByokProvider(workspaceId)

  const repository = repositories?.find((repo) => repo.id === repositoryId)
  if (!repository || !providerKeys) return null

  const override = (repository.reviewBillingMode ?? null) as ReviewBillingMode | null
  const providerOverride = (repository.byokProvider ??
    null) as ProviderKeyProvider | null
  const workspaceDefault = providerKeys.billingMode
  const hasAnyKey = providerKeys.keys.length > 0
  const effectiveMode = override ?? workspaceDefault

  const chooseMode = (next: ReviewBillingMode | null) => {
    if (disabled) return
    setMode.mutate(
      { repositoryId, billingMode: next },
      {
        onError: (error) =>
          toast.error(
            (error as { value?: { error?: string } })?.value?.error ??
              "Failed to update repository billing"
          ),
      }
    )
  }

  const chooseProvider = (next: ProviderKeyProvider | null) => {
    if (disabled) return
    setProvider.mutate(
      { repositoryId, provider: next },
      { onError: () => toast.error("Failed to update key selection") }
    )
  }

  return (
    <SettingsSection
      title="Model billing"
      description={
        override === null
          ? "Following the workspace default — it updates with the workspace."
          : "Using an explicit setting — it won't change with the workspace default."
      }
    >
      <div className="flex flex-col gap-2">
        <RadioOption
          selected={override === null}
          disabled={disabled}
          title="Inherit workspace default"
          description={modeLabel(workspaceDefault)}
          onSelect={() => chooseMode(null)}
        />
        <RadioOption
          selected={override === "platform"}
          disabled={disabled}
          title="Platform billing"
          onSelect={() => chooseMode("platform")}
        />
        <RadioOption
          selected={override === "byok"}
          disabled={disabled || !hasAnyKey}
          title="Bring your own key"
          description={hasAnyKey ? undefined : "Add a key in workspace settings first"}
          onSelect={() => chooseMode("byok")}
        />
      </div>

      {effectiveMode === "byok" && providerKeys.keys.length > 1 ? (
        <>
          <Separator />
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Key to use</span>
            <RadioOption
              selected={providerOverride === null}
              disabled={disabled}
              title="Inherit workspace selection"
              onSelect={() => chooseProvider(null)}
            />
            {providerKeys.keys.map((key) => (
              <RadioOption
                key={key.provider}
                selected={providerOverride === key.provider}
                disabled={disabled}
                title={PROVIDER_LABELS[key.provider]}
                onSelect={() => chooseProvider(key.provider)}
              />
            ))}
          </div>
        </>
      ) : null}
    </SettingsSection>
  )
}
