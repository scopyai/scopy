import { cn } from "@workspace/ui/lib/utils"

export function RadioOption({
  selected,
  disabled,
  title,
  description,
  onSelect,
  className,
}: {
  selected: boolean
  disabled?: boolean
  title: string
  description?: string
  onSelect: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      disabled={disabled || selected}
      onClick={onSelect}
      className={cn(
        "flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-left transition",
        selected ? "border-primary ring-1 ring-primary/40" : "border-border",
        disabled && !selected && "opacity-50",
        className
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
          selected ? "border-primary" : "border-muted-foreground/50"
        )}
      >
        {selected ? <span className="size-2 rounded-full bg-primary" /> : null}
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">{title}</span>
        {description ? (
          <span className="text-xs text-muted-foreground">{description}</span>
        ) : null}
      </span>
    </button>
  )
}
