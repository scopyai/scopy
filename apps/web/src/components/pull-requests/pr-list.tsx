import { GitPullRequestIcon } from "lucide-react"
import { Separator } from "@workspace/ui/components/separator"
import { Skeleton } from "@workspace/ui/components/skeleton"
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
  isSyncing?: boolean
  selectedPullRequestId: string | null | undefined
  onSelect: (id: string) => void
}

export function PullRequestList({
  pullRequests,
  isPending,
  isSyncing = false,
  selectedPullRequestId,
  onSelect,
}: PullRequestListProps) {
  const isInitialLoad = isPending && pullRequests === undefined

  if (isInitialLoad || (isSyncing && pullRequests?.length === 0)) {
    return <PullRequestListSkeleton />
  }

  if (!pullRequests || pullRequests.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        <div className="flex size-10 items-center justify-center rounded-lg border border-border bg-muted">
          <GitPullRequestIcon className="size-5 text-muted-foreground" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">
            No pull requests
          </p>
          <p className="max-w-[220px] text-xs text-muted-foreground">
            Pull requests from this repository will appear here.
          </p>
        </div>
      </div>
    )
  }

  const open = pullRequests.filter((pr) => pr.state === "open")
  const closed = pullRequests.filter((pr) => pr.state !== "open")

  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
      <div className="flex w-full min-w-0 flex-col gap-px px-2 py-2">
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
            <p className="mt-2 text-xs font-medium text-muted-foreground/60">
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
        {isSyncing && (
          <div className="flex flex-col gap-2 px-3 py-2" aria-busy="true">
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        )}
      </div>
    </div>
  )
}

function PullRequestListSkeleton() {
  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden px-5 py-5"
      aria-busy="true"
      aria-label="Loading pull requests"
    >
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className="flex flex-col gap-2">
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-3 w-2/5" />
        </div>
      ))}
    </div>
  )
}
