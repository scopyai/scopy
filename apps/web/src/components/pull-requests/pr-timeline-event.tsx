import type { ElementType } from "react"
import ReactMarkdown from "react-markdown"
import {
  CheckCircleIcon,
  XCircleIcon,
  MessageSquareIcon,
  RotateCcwIcon,
  FileIcon,
  ExternalLinkIcon,
} from "lucide-react"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar"
import { Badge } from "@workspace/ui/components/badge"
import { getLifecycleActionDisplay } from "./pr-status"
import { cn } from "@workspace/ui/lib/utils"

type Author = {
  login: string
  avatarUrl?: string | null
  htmlUrl?: string | null
}

type TimelineEventType =
  | "lifecycle"
  | "issue_comment"
  | "review"
  | "review_comment"

interface TimelineEventProps {
  eventType: TimelineEventType
  action: string | null
  author: Author | null
  body: string | null
  htmlUrl: string | null
  metadata: Record<string, unknown>
  providerCreatedAt: string | Date
  deletedAt: string | Date | null
  isLast: boolean
}

function formatTimestamp(date: string | Date): string {
  return new Date(date).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function MarkdownBody({ content }: { content: string }) {
  return (
    <div className="max-w-none text-sm leading-relaxed [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_h1]:mb-2 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:mb-2 [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:mb-1.5 [&_h3]:text-sm [&_h3]:font-medium [&_hr]:my-3 [&_hr]:border-border [&_li]:mb-0.5 [&_ol]:mb-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mb-3 [&_p:last-child]:mb-0 [&_pre]:mb-3 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-5 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  )
}

const reviewBadgeConfig: Record<
  string,
  { label: string; className: string; icon: ElementType }
> = {
  approved: {
    label: "approved",
    className:
      "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20",
    icon: CheckCircleIcon,
  },
  changes_requested: {
    label: "requested changes",
    className: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
    icon: XCircleIcon,
  },
  commented: {
    label: "reviewed",
    className: "bg-muted text-muted-foreground border-border",
    icon: MessageSquareIcon,
  },
  dismissed: {
    label: "review dismissed",
    className: "bg-muted text-muted-foreground border-border",
    icon: RotateCcwIcon,
  },
}

function LifecycleEvent({
  action,
  author,
}: {
  action: string | null
  author: Author | null
}) {
  const config = getLifecycleActionDisplay(action)
  const Icon = config.icon

  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Icon className={cn("size-3.5 shrink-0", config.iconClassName)} />
      {author ? (
        <span>
          <span className="font-medium text-foreground">{author.login}</span>{" "}
          {config.label}
        </span>
      ) : (
        <span>{config.label}</span>
      )}
    </div>
  )
}

function CommentEvent({
  author,
  body,
  htmlUrl,
  providerCreatedAt,
  deletedAt,
}: {
  author: Author | null
  body: string | null
  htmlUrl: string | null
  providerCreatedAt: string | Date
  deletedAt: string | Date | null
}) {
  return (
    <div className="min-w-0 flex-1 rounded-md border border-border bg-card p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-medium">
          {author?.login ?? "Unknown"}
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="text-xs text-muted-foreground">
            {formatTimestamp(providerCreatedAt)}
          </span>
          {htmlUrl && (
            <a
              href={htmlUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground/60 transition-colors hover:text-muted-foreground"
              aria-label="View on GitHub"
            >
              <ExternalLinkIcon className="size-3" />
            </a>
          )}
        </div>
      </div>
      {deletedAt ? (
        <p className="text-xs text-muted-foreground italic">
          [Comment deleted]
        </p>
      ) : body ? (
        <MarkdownBody content={body} />
      ) : (
        <p className="text-xs text-muted-foreground italic">No content</p>
      )}
    </div>
  )
}

function ReviewEvent({
  author,
  action,
  body,
  htmlUrl,
  providerCreatedAt,
  deletedAt,
}: {
  author: Author | null
  action: string | null
  body: string | null
  htmlUrl: string | null
  providerCreatedAt: string | Date
  deletedAt: string | Date | null
}) {
  const reviewConfig = action
    ? (reviewBadgeConfig[action] ?? reviewBadgeConfig.commented)
    : reviewBadgeConfig.commented
  const ReviewIcon = reviewConfig.icon

  return (
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-sm font-medium">
          {author?.login ?? "Unknown"}
        </span>
        <Badge
          variant="outline"
          className={cn("h-5 gap-1 text-[11px]", reviewConfig.className)}
        >
          <ReviewIcon className="size-3" />
          {reviewConfig.label}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {formatTimestamp(providerCreatedAt)}
        </span>
        {htmlUrl && (
          <a
            href={htmlUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground/60 transition-colors hover:text-muted-foreground"
            aria-label="Star on GitHub"
          >
            <ExternalLinkIcon className="size-3" />
          </a>
        )}
      </div>
      {!deletedAt && body && (
        <div className="mt-2 rounded-md border border-border bg-card p-3">
          <MarkdownBody content={body} />
        </div>
      )}
    </div>
  )
}

function ReviewCommentEvent({
  author,
  body,
  htmlUrl,
  metadata,
  providerCreatedAt,
  deletedAt,
}: {
  author: Author | null
  body: string | null
  htmlUrl: string | null
  metadata: Record<string, unknown>
  providerCreatedAt: string | Date
  deletedAt: string | Date | null
}) {
  const path = typeof metadata.path === "string" ? metadata.path : null
  const line = typeof metadata.line === "number" ? metadata.line : null

  return (
    <div className="min-w-0 flex-1 overflow-hidden rounded-md border border-border bg-card">
      {path && (
        <div className="flex items-center gap-1.5 border-b border-border bg-muted/40 px-3 py-1.5">
          <FileIcon className="size-3 shrink-0 text-muted-foreground" />
          <code className="truncate text-xs text-muted-foreground">
            {path}
            {line != null && `:${line}`}
          </code>
          {htmlUrl && (
            <a
              href={htmlUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto shrink-0 text-muted-foreground/60 transition-colors hover:text-muted-foreground"
              aria-label="Star on GitHub"
            >
              <ExternalLinkIcon className="size-3" />
            </a>
          )}
        </div>
      )}
      <div className="p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium">
            {author?.login ?? "Unknown"}
          </span>
          <span className="text-xs text-muted-foreground">
            {formatTimestamp(providerCreatedAt)}
          </span>
        </div>
        {deletedAt ? (
          <p className="text-xs text-muted-foreground italic">
            [Comment deleted]
          </p>
        ) : body ? (
          <MarkdownBody content={body} />
        ) : (
          <p className="text-xs text-muted-foreground italic">No content</p>
        )}
      </div>
    </div>
  )
}

export function PullRequestTimelineEvent({
  eventType,
  action,
  author,
  body,
  htmlUrl,
  metadata,
  providerCreatedAt,
  deletedAt,
  isLast,
}: TimelineEventProps) {
  const isCompact = eventType === "lifecycle"
  // Review events with no body render a single inline line; centre the avatar on it.
  const isInlineRow = eventType === "review" && !body

  return (
    <div
      className={cn(
        "relative flex gap-3",
        isCompact ? "pb-2" : "pb-3",
        isInlineRow && "items-center"
      )}
    >
      {/* Vertical connector — starts at centre of this node, ends at centre of next */}
      {!isLast && (
        <div
          className="absolute left-3 top-3 -bottom-3 w-px bg-border"
          aria-hidden
        />
      )}

      {/* Node — both types are size-6 (24 px) so the line centre (left-3 = 12 px) is always correct */}
      <div
        className={cn(
          "relative z-10 flex size-6 shrink-0 items-center justify-center",
        )}
      >
        {isCompact ? (
          <div className="size-2.5 rounded-full bg-muted-foreground" />
        ) : (
          <Avatar size="sm">
            {author?.avatarUrl && (
              <AvatarImage src={author.avatarUrl} alt={author?.login ?? ""} />
            )}
            <AvatarFallback>
              {author?.login?.[0]?.toUpperCase()}
            </AvatarFallback>
          </Avatar>
        )}
      </div>

      {/* Event content — bottom gap lives on the outer row, not here */}
      <div className="min-w-0 flex-1">
        {eventType === "lifecycle" && (
          <LifecycleEvent action={action} author={author} />
        )}
        {eventType === "issue_comment" && (
          <CommentEvent
            author={author}
            body={body}
            htmlUrl={htmlUrl}
            providerCreatedAt={providerCreatedAt}
            deletedAt={deletedAt}
          />
        )}
        {eventType === "review" && (
          <ReviewEvent
            author={author}
            action={action}
            body={body}
            htmlUrl={htmlUrl}
            providerCreatedAt={providerCreatedAt}
            deletedAt={deletedAt}
          />
        )}
        {eventType === "review_comment" && (
          <ReviewCommentEvent
            author={author}
            body={body}
            htmlUrl={htmlUrl}
            metadata={metadata}
            providerCreatedAt={providerCreatedAt}
            deletedAt={deletedAt}
          />
        )}
      </div>
    </div>
  )
}
