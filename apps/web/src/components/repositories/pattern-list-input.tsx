import { useState } from "react"
import { PlusIcon, XIcon } from "lucide-react"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { SettingLabelRow } from "@/components/repositories/review-settings-fields"

interface PatternListInputProps {
  id: string
  label: string
  description?: string
  placeholder?: string
  values: string[]
  onChange: (values: string[]) => void
  disabled?: boolean
  scopeBadge?: React.ReactNode
}

export function PatternListInput({
  id,
  label,
  description,
  placeholder,
  values,
  onChange,
  disabled,
  scopeBadge,
}: PatternListInputProps) {
  const [draft, setDraft] = useState("")

  const addPattern = () => {
    if (disabled) return
    const next = draft.trim()
    if (!next) return
    setDraft("")
    if (values.includes(next)) return
    onChange([...values, next])
  }

  const commitDraftOnBlur = () => {
    if (disabled) return
    if (draft.trim()) addPattern()
  }

  const removePattern = (pattern: string) => {
    if (disabled) return
    onChange(values.filter((value) => value !== pattern))
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-col gap-1">
        <SettingLabelRow htmlFor={id} label={label} scopeBadge={scopeBadge} />
        {description ? (
          <p className="text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>

      <div className="min-h-7">
        {values.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {values.map((pattern) => (
              <Badge key={pattern} variant="secondary" className="gap-1 pr-1">
                <span className="font-mono text-[11px]">{pattern}</span>
                <button
                  type="button"
                  onClick={() => removePattern(pattern)}
                  disabled={disabled}
                  className="rounded-sm p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none"
                  aria-label={`Remove ${pattern}`}
                >
                  <XIcon className="size-3" />
                </button>
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No patterns added.</p>
        )}
      </div>

      <div className="flex gap-2">
        <Input
          id={id}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitDraftOnBlur}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              addPattern()
            }
          }}
          placeholder={placeholder}
          disabled={disabled}
          className="h-8 font-mono text-xs"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={addPattern}
          disabled={disabled || !draft.trim()}
        >
          <PlusIcon className="size-3.5" />
          Add
        </Button>
      </div>
    </div>
  )
}
