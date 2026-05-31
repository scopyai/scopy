import type { ElementType } from "react"
import {
  GitPullRequestArrowIcon,
  GitPullRequestDraftIcon,
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestIcon,
} from "lucide-react"

export type PullRequestState = "open" | "closed" | "merged"
export type PullRequestDisplayState = PullRequestState | "draft"

/** Lifecycle actions stored from GitHub webhooks and initial sync. */
export type PullRequestLifecycleAction =
  | "opened"
  | "closed"
  | "reopened"
  | "merged"
  | "ready_for_review"
  | "converted_to_draft"

export const PULL_REQUEST_LIFECYCLE_ACTIONS = [
  "opened",
  "closed",
  "reopened",
  "merged",
  "ready_for_review",
  "converted_to_draft",
] as const satisfies readonly PullRequestLifecycleAction[]

const GREEN_ICON = "text-green-500"
const GREEN_BADGE =
  "bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20"
const RED_ICON = "text-red-500"
const RED_BADGE =
  "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20"
const PURPLE_ICON = "text-purple-500"
const PURPLE_BADGE =
  "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20"
const MUTED_ICON = "text-muted-foreground"
const MUTED_BADGE = "bg-muted text-muted-foreground border-border"

type StateDisplay = {
  icon: ElementType
  label: string
  iconClassName: string
  badgeClassName: string
}

type LifecycleDisplay = {
  icon: ElementType
  label: string
  iconClassName: string
}

export function getPullRequestDisplayState(
  state: PullRequestState,
  draft: boolean,
): PullRequestDisplayState {
  if (state === "open" && draft) return "draft"
  return state
}

export const pullRequestStateDisplay: Record<
  PullRequestDisplayState,
  StateDisplay
> = {
  open: {
    icon: GitPullRequestArrowIcon,
    label: "Open",
    iconClassName: GREEN_ICON,
    badgeClassName: GREEN_BADGE,
  },
  merged: {
    icon: GitMergeIcon,
    label: "Merged",
    iconClassName: PURPLE_ICON,
    badgeClassName: PURPLE_BADGE,
  },
  closed: {
    icon: GitPullRequestClosedIcon,
    label: "Closed",
    iconClassName: RED_ICON,
    badgeClassName: RED_BADGE,
  },
  draft: {
    icon: GitPullRequestDraftIcon,
    label: "Draft",
    iconClassName: MUTED_ICON,
    badgeClassName: MUTED_BADGE,
  },
}

export const pullRequestLifecycleDisplay: Record<
  PullRequestLifecycleAction,
  LifecycleDisplay
> = {
  opened: {
    icon: GitPullRequestArrowIcon,
    label: "opened this pull request",
    iconClassName: GREEN_ICON,
  },
  reopened: {
    icon: GitPullRequestArrowIcon,
    label: "reopened this pull request",
    iconClassName: GREEN_ICON,
  },
  ready_for_review: {
    icon: GitPullRequestArrowIcon,
    label: "marked this pull request as ready for review",
    iconClassName: GREEN_ICON,
  },
  closed: {
    icon: GitPullRequestClosedIcon,
    label: "closed this pull request",
    iconClassName: RED_ICON,
  },
  merged: {
    icon: GitMergeIcon,
    label: "merged this pull request",
    iconClassName: PURPLE_ICON,
  },
  converted_to_draft: {
    icon: GitPullRequestDraftIcon,
    label: "converted this pull request to draft",
    iconClassName: MUTED_ICON,
  },
}

export function getPullRequestStateDisplay(
  state: PullRequestState,
  draft: boolean,
): StateDisplay {
  return pullRequestStateDisplay[getPullRequestDisplayState(state, draft)]
}

function formatUnknownLifecycleAction(action: string): string {
  return action.replace(/_/g, " ")
}

export function getLifecycleActionDisplay(
  action: string | null,
): LifecycleDisplay {
  if (
    action &&
    Object.hasOwn(pullRequestLifecycleDisplay, action)
  ) {
    return pullRequestLifecycleDisplay[action as PullRequestLifecycleAction]
  }

  return {
    icon: GitPullRequestIcon,
    label: action
      ? `${formatUnknownLifecycleAction(action)} this pull request`
      : "updated this pull request",
    iconClassName: MUTED_ICON,
  }
}
