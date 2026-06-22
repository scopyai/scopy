import { Label } from "@workspace/ui/components/label"

export function SettingLabelRow({
  htmlFor,
  label,
  scopeBadge,
}: {
  htmlFor: string
  label: string
  scopeBadge?: React.ReactNode
}) {
  return (
    <div className="flex min-h-5 flex-wrap items-center gap-x-2 gap-y-0">
      <Label htmlFor={htmlFor} className="leading-5">
        {label}
      </Label>
      {scopeBadge}
    </div>
  )
}
