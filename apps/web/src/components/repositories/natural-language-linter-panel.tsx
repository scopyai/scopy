import { useState } from "react"
import { PlusIcon, SparklesIcon, XIcon } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Separator } from "@workspace/ui/components/separator"
import { Textarea } from "@workspace/ui/components/textarea"
import { cn } from "@workspace/ui/lib/utils"
import { SettingsSection } from "@/components/repositories/settings-section"

interface NaturalLanguageLinterPanelProps {
  rules: string[]
  onChange: (rules: string[]) => void
  disabled?: boolean
}

export function NaturalLanguageLinterPanel({
  rules,
  onChange,
  disabled = false,
}: NaturalLanguageLinterPanelProps) {
  const [draft, setDraft] = useState("")

  const commitDraft = () => {
    if (disabled) return
    const next = draft.trim()
    if (!next) return
    if (!rules.includes(next)) {
      onChange([...rules, next])
    }
    setDraft("")
  }

  const handleRemoveRule = (rule: string) => {
    if (disabled) return
    onChange(rules.filter((item) => item !== rule))
  }

  return (
    <SettingsSection
      title="Natural language linter"
      description="Describe coding standards in plain English. Scopy will flag pull requests that break these rules during review."
    >
      <fieldset
        disabled={disabled}
        className={cn(
          "flex min-w-0 flex-col gap-4 border-0 p-0 m-0",
          disabled && "opacity-60",
        )}
      >
        {rules.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {rules.map((rule) => (
              <li key={rule} className="flex items-start gap-2">
                <SparklesIcon className="mt-0.5 size-3.5 shrink-0 text-primary/70" />
                <p className="min-w-0 flex-1 text-sm leading-relaxed">{rule}</p>
                <button
                  type="button"
                  onClick={() => handleRemoveRule(rule)}
                  className="shrink-0 rounded-sm p-0.5 text-muted-foreground hover:text-foreground disabled:pointer-events-none"
                  aria-label={`Remove rule: ${rule}`}
                >
                  <XIcon className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">No rules added yet.</p>
        )}

        {rules.length > 0 ? <Separator /> : null}

        <div className="flex flex-col gap-2">
          <Textarea
            id="natural-language-linter-rule"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commitDraft}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault()
                commitDraft()
              }
            }}
            placeholder="Don't use raw SQL when an ORM function exists."
            rows={3}
            className="min-h-20 resize-y text-sm"
          />
          <div className="flex items-center justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={commitDraft}
              disabled={!draft.trim()}
            >
              <PlusIcon className="size-3.5" />
              Add rule
            </Button>
          </div>
        </div>
      </fieldset>
    </SettingsSection>
  )
}
