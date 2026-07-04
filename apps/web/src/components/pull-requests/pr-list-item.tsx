import { Badge } from "@workspace/ui/components/badge"
import type { PullRequestState } from "./pr-status"
import { getPullRequestStateDisplay } from "./pr-status"
import { cn } from "@workspace/ui/lib/utils"
import { tagToneClassName } from "@/lib/tag-tones"

interface PullRequestListItemProps {
  id: string
  number: number
  title: string
  author: { login: string; avatarUrl?: string | null } | null
  state: PullRequestState
  draft: boolean
  labels: string[]
  providerUpdatedAt: string | Date
  isSelected: boolean
  onClick: () => void
}

function formatRelativeTime(date: string | Date): string {
  const now = new Date()
  const then = new Date(date)
  const diffMs = now.getTime() - then.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHour = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHour / 24)
  const diffMonth = Math.floor(diffDay / 30)
  const diffYear = Math.floor(diffMonth / 12)

  if (diffYear > 0) return `${diffYear}y ago`
  if (diffMonth > 0) return `${diffMonth}mo ago`
  if (diffDay > 0) return `${diffDay}d ago`
  if (diffHour > 0) return `${diffHour}h ago`
  if (diffMin > 0) return `${diffMin}m ago`
  return "just now"
}

export function PullRequestListItem({
  number,
  title,
  author,
  state,
  draft,
  labels,
  providerUpdatedAt,
  isSelected,
  onClick,
}: PullRequestListItemProps) {
  const { icon: StateIcon, iconClassName: stateClassName } =
    getPullRequestStateDisplay(state, draft)

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full text-left px-3 py-2.5 rounded-md transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        isSelected && "bg-accent",
      )}
    >
      <div className="flex items-start gap-2">
        <StateIcon className={cn("mt-0.5 size-4 shrink-0", stateClassName)} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline gap-1.5">
            <p className="min-w-0 truncate text-sm font-medium leading-snug">
              {title}
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                #{number}
              </span>
            </p>
            {draft && (
              <Badge variant="outline" className="h-4 shrink-0 text-[10px] px-1 py-0">
                Draft
              </Badge>
            )}
          </div>
          <div className="mt-1 flex items-center gap-1.5 flex-wrap">
            {author && (
              <span className="text-xs text-muted-foreground">{author.login}</span>
            )}
            <span className="text-xs text-muted-foreground/60">·</span>
            <span className="text-xs text-muted-foreground">
              {formatRelativeTime(providerUpdatedAt)}
            </span>
            {labels.slice(0, 2).map((label) => (
              <Badge
                key={label}
                variant="outline"
                className={tagToneClassName(label, "h-4 px-1.5 py-0 text-[10px]")}
              >
                {label}
              </Badge>
            ))}
            {labels.length > 2 && (
              <span className="text-xs text-muted-foreground">+{labels.length - 2}</span>
            )}
          </div>
        </div>
      </div>
    </button>
  )
}
