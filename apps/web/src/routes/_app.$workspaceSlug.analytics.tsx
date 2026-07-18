import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { z } from "zod"
import { BarChart3Icon } from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"
import { PageHeader } from "@/components/page-header"
import { useWorkspaceContext } from "@/contexts/workspace-context"
import { useRepositories } from "@/hooks/use-repositories"
import {
  useWorkspaceAnalytics,
  workspaceAnalyticsRanges,
} from "@/hooks/use-workspace-analytics"
import type { WorkspaceAnalyticsRange } from "@/hooks/use-workspace-analytics"
import { AnalyticsFilters } from "@/components/analytics/analytics-filters"
import {
  AnalyticsSummaryCards,
  AnalyticsSummaryCardsSkeleton,
} from "@/components/analytics/analytics-summary-cards"
import {
  PrReviewsChart,
  PrReviewsChartSkeleton,
} from "@/components/analytics/pr-reviews-chart"
import {
  BugsCaughtChart,
  BugsCaughtChartSkeleton,
} from "@/components/analytics/bugs-caught-chart"
import {
  PrHeatmapChart,
  PrHeatmapChartSkeleton,
} from "@/components/analytics/pr-heatmap-chart"
import {
  SeverityDistributionChart,
  SeverityDistributionChartSkeleton,
} from "@/components/analytics/severity-distribution-chart"
import {
  MostFlaggedFiles,
  MostFlaggedFilesSkeleton,
  BugProneLanguagesChart,
  BugProneLanguagesChartSkeleton,
} from "@/components/analytics/codebase-health"

const searchSchema = z.object({
  range: z.enum(workspaceAnalyticsRanges).catch("last_30_days"),
  repositoryId: z.string().optional(),
  authorId: z.string().optional(),
})

export const Route = createFileRoute("/_app/$workspaceSlug/analytics")({
  validateSearch: searchSchema,
  component: AnalyticsRoute,
})

function AnalyticsRoute() {
  const { range, repositoryId, authorId } = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const { selectedWorkspaceId } = useWorkspaceContext()

  const { data: repositories, isPending: repositoriesPending } =
    useRepositories(selectedWorkspaceId)

  const repositoryIds = repositoryId ? [repositoryId] : []
  const authorIds = authorId ? [authorId] : []

  const { data, isPending, isFetching, isError, refetch } =
    useWorkspaceAnalytics(selectedWorkspaceId, {
      range,
      repositoryIds,
      authorIds,
    })

  const isInitialLoad = isPending && !data
  const isRefreshing = isFetching && !!data

  function handleRangeChange(newRange: WorkspaceAnalyticsRange) {
    navigate({
      search: (prev) => ({ ...prev, range: newRange }),
    })
  }

  function handleRepositoryChange(newRepositoryId: string | undefined) {
    navigate({
      search: (prev) => ({
        ...prev,
        repositoryId: newRepositoryId,
        authorId: undefined,
      }),
    })
  }

  function handleAuthorChange(newAuthorId: string | undefined) {
    navigate({
      search: (prev) => ({ ...prev, authorId: newAuthorId }),
    })
  }

  if (!selectedWorkspaceId) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <PageHeader icon={BarChart3Icon} title="Analytics" />
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-muted-foreground">
            Select an organization to view analytics
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader icon={BarChart3Icon} title="Analytics" />

      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="flex flex-col gap-6">
          <AnalyticsFilters
            range={range}
            onRangeChange={handleRangeChange}
            repositoryId={repositoryId}
            onRepositoryChange={handleRepositoryChange}
            repositories={repositories ?? []}
            repositoriesPending={repositoriesPending}
            authorId={authorId}
            onAuthorChange={handleAuthorChange}
            authors={data?.availableAuthors ?? []}
            authorsPending={isInitialLoad}
            isLoading={isRefreshing}
          />

          {isError && !data && (
            <div className="flex flex-col items-center justify-center gap-3 py-16">
              <p className="text-sm text-muted-foreground">
                Failed to load analytics
              </p>
              <button
                className="text-sm text-primary underline-offset-4 hover:underline"
                onClick={() => refetch()}
              >
                Try again
              </button>
            </div>
          )}

          {isInitialLoad && (
            <>
              <AnalyticsSummaryCardsSkeleton />
              <div className="grid gap-4 lg:grid-cols-2">
                <PrReviewsChartSkeleton />
                <BugsCaughtChartSkeleton />
              </div>
              <PrHeatmapChartSkeleton />
              <div className="grid gap-4 lg:grid-cols-2">
                <SeverityDistributionChartSkeleton />
                <BugProneLanguagesChartSkeleton />
              </div>
              <MostFlaggedFilesSkeleton />
            </>
          )}

          {data && (
            <div
              className={cn(
                "flex flex-col gap-6 transition-opacity duration-200",
                isRefreshing && "pointer-events-none opacity-60",
              )}
              aria-busy={isRefreshing}
            >
              <AnalyticsSummaryCards summary={data.summary} />

              <div className="grid gap-4 lg:grid-cols-2">
                <PrReviewsChart data={data.prReviewsGraph} />
                <BugsCaughtChart data={data.bugsCaughtGraph} />
              </div>

              <PrHeatmapChart data={data.prHeatmap} />

              <div className="grid gap-4 lg:grid-cols-2">
                <SeverityDistributionChart data={data.severityDistribution} />
                <BugProneLanguagesChart
                  data={data.codebaseHealth.bugProneLanguages}
                />
              </div>

              <MostFlaggedFiles data={data.codebaseHealth.mostFlaggedFiles} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
