import { GitPullRequestIcon } from "lucide-react"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
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
  const isInitialLoad = isPending && pullRequests === undefined

  if (isInitialLoad) {
    return <div className="min-h-0 flex-1" aria-busy="true" />
  }

  if (!pullRequests || pullRequests.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        <div className="flex size-10 items-center justify-center rounded-lg border border-border bg-muted">
          <GitPullRequestIcon className="size-5 text-muted-foreground" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">No pull requests</p>
          <p className="max-w-[220px] text-xs text-muted-foreground">
            Enable repository tracking to import pull requests from GitHub.
          </p>
        </div>
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
      </div>
    </ScrollArea>
  )
}
