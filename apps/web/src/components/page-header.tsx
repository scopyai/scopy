import type { LucideIcon } from "lucide-react"

interface PageHeaderProps {
  icon: LucideIcon
  title: string
}

export function PageHeader({ icon: Icon, title }: PageHeaderProps) {
  return (
    <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="text-base font-medium">{title}</span>
    </div>
  )
}
