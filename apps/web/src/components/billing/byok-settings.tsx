import { useState } from "react"
import { Trash2Icon } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Badge } from "@workspace/ui/components/badge"
import { Separator } from "@workspace/ui/components/separator"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { RadioOption } from "@/components/radio-option"
import { SettingsSection } from "@/components/repositories/settings-section"
import {
  useDeleteProviderKey,
  useProviderKeys,
  useSetProviderKey,
  useSetWorkspaceBillingMode,
  useSetWorkspaceByokProvider,
  type ProviderKeyProvider,
} from "@/hooks/use-provider-keys"

const PROVIDER_LABELS: Record<ProviderKeyProvider, string> = {
  openrouter: "OpenRouter",
  gateway: "Vercel AI Gateway",
}

const PROVIDERS: { id: ProviderKeyProvider; hint: string }[] = [
  { id: "openrouter", hint: "Create a key at openrouter.ai/keys" },
  { id: "gateway", hint: "Create a key in your Vercel AI Gateway dashboard" },
]

function ProviderKeyRow({
  workspaceId,
  provider,
  hint,
  preview,
  disabled,
  onSaved,
}: {
  workspaceId: string
  provider: ProviderKeyProvider
  hint: string
  preview: string | null
  disabled: boolean
  onSaved: () => void
}) {
  const [value, setValue] = useState("")
  const setKey = useSetProviderKey(workspaceId)
  const deleteKey = useDeleteProviderKey(workspaceId)
  const label = PROVIDER_LABELS[provider]

  const save = () => {
    const apiKey = value.trim()
    if (!apiKey) return
    setKey.mutate(
      { provider, apiKey },
      {
        onSuccess: () => {
          setValue("")
          toast.success(`${label} key saved`)
          onSaved()
        },
        onError: (error) => {
          toast.error(
            (error as { value?: { error?: string } })?.value?.error ??
              `Failed to save ${label} key`
          )
        },
      }
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{label}</span>
        {preview ? (
          <Badge variant="secondary" className="font-mono text-xs">
            {preview}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">Not configured</span>
        )}
        {preview ? (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-7 px-2 text-muted-foreground"
            disabled={disabled || deleteKey.isPending}
            onClick={() =>
              deleteKey.mutate(
                { provider },
                {
                  onSuccess: () => toast.success(`${label} key removed`),
                  onError: () => toast.error(`Failed to remove ${label} key`),
                }
              )
            }
          >
            <Trash2Icon className="size-3.5" />
            Remove
          </Button>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <Input
          type="password"
          autoComplete="off"
          placeholder={preview ? "Enter a new key to replace" : "Paste API key"}
          value={value}
          disabled={disabled || setKey.isPending}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") save()
          }}
        />
        <Button
          size="sm"
          disabled={disabled || setKey.isPending || !value.trim()}
          onClick={save}
        >
          {setKey.isPending ? "Saving…" : preview ? "Replace" : "Save"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  )
}

export function ByokSettings({
  workspaceId,
  canEdit,
}: {
  workspaceId: string
  canEdit: boolean
}) {
  const { data, isPending, isError, refetch } = useProviderKeys(workspaceId)
  const setBillingMode = useSetWorkspaceBillingMode(workspaceId)
  const setByokProvider = useSetWorkspaceByokProvider(workspaceId)
  const [view, setView] = useState<"platform" | "byok" | null>(null)

  if (isPending) {
    return <Skeleton className="h-48 w-full rounded-lg" />
  }

  if (isError || !data) {
    return (
      <SettingsSection
        title="Model billing"
        description="Choose how reviews are paid for in this workspace."
      >
        <div className="flex flex-col items-center gap-3 py-2 text-center">
          <p className="text-sm text-muted-foreground">
            Failed to load billing settings.
          </p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Try again
          </Button>
        </div>
      </SettingsSection>
    )
  }

  const previews = new Map(data.keys.map((key) => [key.provider, key.keyPreview]))
  const hasAnyKey = data.keys.length > 0
  const showByok = (view ?? data.billingMode) === "byok"
  const byokActive = data.billingMode === "byok"

  const activate = (billingMode: "platform" | "byok") => {
    if (data.billingMode === billingMode) return
    setBillingMode.mutate(
      { billingMode },
      {
        onError: (error) => {
          toast.error(
            (error as { value?: { error?: string } })?.value?.error ??
              "Failed to update billing mode"
          )
        },
      }
    )
  }

  const selectPlatform = () => {
    if (!canEdit) return
    setView("platform")
    activate("platform")
  }

  const selectByok = () => {
    if (!canEdit) return
    setView("byok")
    if (hasAnyKey) activate("byok")
  }

  return (
    <SettingsSection
      title="Model billing"
      description="Choose how reviews are paid for in this workspace."
    >
      <div className="flex flex-col gap-3 sm:flex-row">
        <RadioOption
          className="flex-1"
          selected={!showByok}
          disabled={!canEdit}
          title="Platform billing"
          description="Reviews run on our keys and use your workspace credits."
          onSelect={selectPlatform}
        />
        <RadioOption
          className="flex-1"
          selected={showByok}
          disabled={!canEdit}
          title="Bring your own key"
          description="Use your own provider key. Not charged to workspace credits."
          onSelect={selectByok}
        />
      </div>

      {showByok ? (
        <>
          <Separator />

          {!byokActive ? (
            <p className="text-xs text-muted-foreground">
              Platform billing stays active until you add a key below.
            </p>
          ) : null}

          {data.keys.length > 1 ? (
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium">Key to use for reviews</span>
              <RadioOption
                selected={data.byokProvider === null}
                disabled={!canEdit}
                title="Automatic"
                description="Prefer OpenRouter when available."
                onSelect={() => setByokProvider.mutate({ provider: null })}
              />
              {data.keys.map((key) => (
                <RadioOption
                  key={key.provider}
                  selected={data.byokProvider === key.provider}
                  disabled={!canEdit}
                  title={PROVIDER_LABELS[key.provider]}
                  onSelect={() =>
                    setByokProvider.mutate({ provider: key.provider })
                  }
                />
              ))}
            </div>
          ) : null}

          {PROVIDERS.map((provider) => (
            <ProviderKeyRow
              key={provider.id}
              workspaceId={workspaceId}
              provider={provider.id}
              hint={provider.hint}
              preview={previews.get(provider.id) ?? null}
              disabled={!canEdit}
              onSaved={() => activate("byok")}
            />
          ))}

          <p className="text-xs text-muted-foreground">
            Keys are encrypted at rest and never shown again after saving — only a
            masked preview is displayed.
          </p>
        </>
      ) : null}

      {!canEdit ? (
        <p className="text-xs text-muted-foreground">
          Only workspace admins can change billing settings.
        </p>
      ) : null}
    </SettingsSection>
  )
}
