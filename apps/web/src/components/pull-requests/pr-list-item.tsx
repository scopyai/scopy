import { GitPullRequestIcon, GitMergeIcon, GitPullRequestClosedIcon } from "lucide-react"
import { Badge } from "@workspace/ui/components/badge"
import { cn } from "@workspace/ui/lib/utils"

type PullRequestState = "open" | "closed" | "merged"

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

const stateConfig: Record<
  PullRequestState,
  { icon: React.ElementType; className: string }
> = {
  open: {
    icon: GitPullRequestIcon,
    className: "text-green-500",
  },
  merged: {
    icon: GitMergeIcon,
    className: "text-purple-500",
  },
  closed: {
    icon: GitPullRequestClosedIcon,
    className: "text-muted-foreground",
  },
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
  const { icon: StateIcon, className: stateClassName } = stateConfig[state]

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
        <StateIcon className={cn("mt-0.5 size-3.5 shrink-0", stateClassName)} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-medium text-muted-foreground shrink-0">
              #{number}
            </span>
            {draft && (
              <Badge variant="outline" className="h-4 text-[10px] px-1 py-0 shrink-0">
                Draft
              </Badge>
            )}
          </div>
          <p className="mt-0.5 text-sm font-medium leading-snug truncate">{title}</p>
          <div className="mt-1 flex items-center gap-1.5 flex-wrap">
            {author && (
              <span className="text-xs text-muted-foreground">{author.login}</span>
            )}
            <span className="text-xs text-muted-foreground/60">·</span>
            <span className="text-xs text-muted-foreground">
              {formatRelativeTime(providerUpdatedAt)}
            </span>
            {labels.slice(0, 2).map((label) => (
              <Badge key={label} variant="secondary" className="h-4 text-[10px] px-1.5 py-0">
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
