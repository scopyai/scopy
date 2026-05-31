import ReactMarkdown from "react-markdown"
import {
  GitPullRequestIcon,
  GitMergeIcon,
  GitPullRequestClosedIcon,
  ArrowRightIcon,
  ExternalLinkIcon,
  XIcon,
} from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@workspace/ui/components/avatar"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { Separator } from "@workspace/ui/components/separator"
import { PullRequestTimelineEvent } from "./pr-timeline-event"
import { cn } from "@workspace/ui/lib/utils"

type Author = {
  login: string
  avatarUrl?: string | null
  htmlUrl?: string | null
}

type TimelineEvent = {
  id: string
  eventType: "lifecycle" | "issue_comment" | "review" | "review_comment"
  action: string | null
  author: Author | null
  body: string | null
  htmlUrl: string | null
  metadata: Record<string, unknown>
  providerCreatedAt: string | Date
  deletedAt: string | Date | null
}

type PullRequestDetail = {
  id: string
  number: number
  title: string
  body: string | null
  htmlUrl: string
  author: Author | null
  state: "open" | "closed" | "merged"
  draft: boolean
  baseRef: string
  headRef: string
  labels: string[]
  assignees: Author[]
  openedAt: string | Date
  timeline: TimelineEvent[]
}

interface PullRequestDetailProps {
  pullRequest: PullRequestDetail | undefined
  isPending: boolean
  onClose: () => void
}

const stateConfig = {
  open: {
    icon: GitPullRequestIcon,
    label: "Open",
    className: "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20",
  },
  merged: {
    icon: GitMergeIcon,
    label: "Merged",
    className: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
  },
  closed: {
    icon: GitPullRequestClosedIcon,
    label: "Closed",
    className: "bg-muted text-muted-foreground border-border",
  },
}

function PullRequestDetailSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="space-y-2">
        <Skeleton className="h-6 w-3/4" />
        <Skeleton className="h-4 w-1/3" />
      </div>
      <Skeleton className="h-px w-full" />
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="size-5 rounded-full shrink-0" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function PullRequestDetail({
  pullRequest,
  isPending,
  onClose,
}: PullRequestDetailProps) {
  if (isPending) {
    return (
      <div className="flex h-full flex-col border-l border-border">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="size-6 rounded" />
        </div>
        <PullRequestDetailSkeleton />
      </div>
    )
  }

  if (!pullRequest) return null

  const { icon: StateIcon, label: stateLabel, className: stateClassName } =
    stateConfig[pullRequest.state]

  return (
    <div className="flex h-full flex-col border-l border-border">
      {/* Panel header */}
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2.5">
        <a
          href={pullRequest.htmlUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          View on GitHub
          <ExternalLinkIcon className="size-3" />
        </a>
        <Button
          variant="ghost"
          size="sm"
          className="size-6 p-0"
          onClick={onClose}
          aria-label="Close panel"
        >
          <XIcon className="size-3.5" />
        </Button>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-4 space-y-4">
          {/* Title and meta */}
          <div>
            <div className="flex items-start gap-2 flex-wrap mb-2">
              <Badge variant="outline" className={cn("h-5 gap-1 shrink-0 text-xs", stateClassName)}>
                <StateIcon className="size-3" />
                {stateLabel}
              </Badge>
              {pullRequest.draft && (
                <Badge variant="outline" className="h-5 text-xs">
                  Draft
                </Badge>
              )}
            </div>
            <h2 className="text-base font-semibold leading-snug">
              {pullRequest.title}
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                #{pullRequest.number}
              </span>
            </h2>

            {/* Author */}
            <div className="mt-2 flex items-center gap-2">
              {pullRequest.author && (
                <>
                  <Avatar size="sm">
                    {pullRequest.author.avatarUrl && (
                      <AvatarImage
                        src={pullRequest.author.avatarUrl}
                        alt={pullRequest.author.login}
                      />
                    )}
                    <AvatarFallback>
                      {pullRequest.author.login[0]?.toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {pullRequest.author.login}
                    </span>{" "}
                    wants to merge into
                  </span>
                </>
              )}
            </div>

            {/* Branch refs */}
            <div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground flex-wrap">
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                {pullRequest.baseRef}
              </code>
              <ArrowRightIcon className="size-3 shrink-0" />
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                {pullRequest.headRef}
              </code>
            </div>

            {/* Labels */}
            {pullRequest.labels.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {pullRequest.labels.map((label) => (
                  <Badge key={label} variant="secondary" className="h-4 text-[10px]">
                    {label}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Body */}
          {pullRequest.body && (
            <>
              <Separator />
              <div className="max-w-none text-sm leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_p]:mb-3 [&_p:last-child]:mb-0 [&_h1]:mb-2 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:mb-1.5 [&_h3]:text-sm [&_h3]:font-medium [&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:mb-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:mb-0.5 [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_code]:font-mono [&_pre]:mb-3 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_hr]:border-border [&_hr]:my-3">
                <ReactMarkdown>{pullRequest.body}</ReactMarkdown>
              </div>
            </>
          )}

          {/* Timeline */}
          {pullRequest.timeline.length > 0 && (
            <>
              <Separator />
              <div className="space-y-0">
                {pullRequest.timeline.map((event, index) => (
                  <PullRequestTimelineEvent
                    key={event.id}
                    {...event}
                    isLast={index === pullRequest.timeline.length - 1}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
