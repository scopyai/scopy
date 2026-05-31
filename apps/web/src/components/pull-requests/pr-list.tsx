import { GitPullRequestIcon } from "lucide-react"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { Separator } from "@workspace/ui/components/separator"
import { PullRequestListItem } from "./pr-list-item"

type PullRequest = {
  id: string
  number: number
  title: string
  author: { login: string; avatarUrl?: string | null } | null
  state: "open" | "closed" | "merged"
  draft: boolean
  labels: string[]
  providerUpdatedAt: string | Date
}

interface PullRequestListProps {
  pullRequests: PullRequest[] | undefined
  isPending: boolean
  selectedPullRequestId: string | null | undefined
  onSelect: (id: string) => void
}

export function PullRequestList({
  pullRequests,
  isPending,
  selectedPullRequestId,
  onSelect,
}: PullRequestListProps) {
  if (isPending) {
    return (
      <div className="flex flex-col gap-px px-2 py-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-start gap-2 rounded-md px-3 py-2.5">
            <Skeleton className="mt-0.5 size-3.5 rounded-full shrink-0" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-3 w-12" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-32" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (!pullRequests || pullRequests.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-12 text-center px-4">
        <GitPullRequestIcon className="size-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">No pull requests found</p>
        <p className="text-xs text-muted-foreground/60">
          Enable repository tracking to import pull requests.
        </p>
      </div>
    )
  }

  const open = pullRequests.filter((pr) => pr.state === "open")
  const closed = pullRequests.filter((pr) => pr.state !== "open")

  return (
    <ScrollArea className="flex-1 min-h-0">
      <div className="flex flex-col gap-px px-2 py-2">
        {open.map((pr) => (
          <PullRequestListItem
            key={pr.id}
            {...pr}
            isSelected={pr.id === selectedPullRequestId}
            onClick={() => onSelect(pr.id)}
          />
        ))}
        {open.length > 0 && closed.length > 0 && (
          <div className="px-3 py-2">
            <Separator />
            <p className="mt-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
              Closed / Merged
            </p>
          </div>
        )}
        {closed.map((pr) => (
          <PullRequestListItem
            key={pr.id}
            {...pr}
            isSelected={pr.id === selectedPullRequestId}
            onClick={() => onSelect(pr.id)}
          />
        ))}
      </div>
    </ScrollArea>
  )
}
