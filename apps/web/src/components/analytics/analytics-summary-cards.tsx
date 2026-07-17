import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { GitPullRequestIcon, BugIcon, GitMergeIcon, ClockIcon } from "lucide-react"

type Summary = {
  totalPrReviews: number
  reviewedPrCount: number
  bugsCaught: number
  mergedPrCount: number
  averageTimeToMergeHours: number | null
  averageTimeToMergeDays: number | null
}

function formatMergeTime(
  hours: number | null,
  days: number | null,
): string {
  if (hours === null) return "–"
  if (days !== null && days >= 1) {
    return `${days.toFixed(1)}d`
  }
  return `${Math.round(hours)}h`
}

function SummaryCard({
  icon: Icon,
  title,
  value,
  subtitle,
}: {
  icon: React.ElementType
  title: string
  value: string
  subtitle?: string
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Icon className="size-4 text-muted-foreground" />
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {title}
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-bold tabular-nums text-foreground">{value}</p>
        {subtitle && (
          <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
        )}
      </CardContent>
    </Card>
  )
}

export function AnalyticsSummaryCards({ summary }: { summary: Summary }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <SummaryCard
        icon={GitPullRequestIcon}
        title="PR Reviews"
        value={summary.totalPrReviews.toLocaleString()}
        subtitle={`${summary.reviewedPrCount} distinct PRs`}
      />
      <SummaryCard
        icon={BugIcon}
        title="Bugs Caught"
        value={summary.bugsCaught.toLocaleString()}
      />
      <SummaryCard
        icon={GitMergeIcon}
        title="PRs Merged"
        value={summary.mergedPrCount.toLocaleString()}
      />
      <SummaryCard
        icon={ClockIcon}
        title="Avg Time to Merge"
        value={formatMergeTime(
          summary.averageTimeToMergeHours,
          summary.averageTimeToMergeDays,
        )}
        subtitle={
          summary.mergedPrCount > 0
            ? `across ${summary.mergedPrCount} merged PRs`
            : undefined
        }
      />
    </div>
  )
}

export function AnalyticsSummaryCardsSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <Card key={i}>
          <CardHeader className="pb-2">
            <Skeleton className="h-4 w-28" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-8 w-20" />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
