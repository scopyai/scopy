import { useState } from "react"
import { Skeleton } from "@workspace/ui/components/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import {
  useWorkspaceBillingUsage,
  useWorkspaceUsageTrend,
} from "@/hooks/use-workspace-billing-usage"
import {
  formatDate,
  formatReviewCredits,
} from "@/lib/billing-format"
import { HistoryPagination } from "./history-pagination"
import { UsageTrendChart } from "./usage-trend-chart"

const PAGE_SIZE = 25

type UsageItem = NonNullable<
  ReturnType<typeof useWorkspaceBillingUsage>["data"]
>["items"][number]

const formatNumber = (value: number) => value.toLocaleString("en-US")

const reviewLabel = (item: UsageItem) =>
  item.repositoryName
    ? `${item.repositoryName}${item.pullRequestNumber ? ` #${item.pullRequestNumber}` : ""}`
    : "Review"

export function UsageHistory({
  workspaceId,
}: {
  workspaceId: string | null | undefined
}) {
  const [page, setPage] = useState(1)
  const { data, isFetching, isPending } = useWorkspaceBillingUsage(
    workspaceId,
    page,
    PAGE_SIZE,
  )
  const { data: trend } = useWorkspaceUsageTrend(workspaceId)

  const totalPages = data ? Math.ceil(data.total / data.pageSize) : 0

  return (
    <div className="flex flex-col gap-4">
      <UsageTrendChart points={trend ?? []} />

      <div className="flex flex-col gap-4 rounded-lg border bg-card px-4 py-4">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-sm font-medium">Review usage</h3>
          <p className="text-xs text-muted-foreground">
            Pull request reviews and credit charges for this workspace
          </p>
        </div>
        <div className="flex flex-col gap-4">
          {isPending ? (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : !data || data.items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No review usage yet
            </p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Repository / PR</TableHead>
                      <TableHead className="text-right">Lines</TableHead>
                      <TableHead className="text-right">Additions</TableHead>
                      <TableHead className="text-right">Deletions</TableHead>
                      <TableHead className="text-right">Credits</TableHead>
                      <TableHead className="text-right">
                        Balance after
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {formatDate(item.createdAt)}
                        </TableCell>
                        <TableCell className="max-w-80">
                          <div className="flex flex-col">
                            {item.pullRequestUrl ? (
                              <a
                                href={item.pullRequestUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="truncate font-medium hover:underline"
                              >
                                {reviewLabel(item)}
                              </a>
                            ) : (
                              <span className="truncate font-medium">
                                {reviewLabel(item)}
                              </span>
                            )}
                            {item.pullRequestTitle ? (
                              <span className="truncate text-xs text-muted-foreground">
                                {item.pullRequestTitle}
                              </span>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatNumber(item.reviewableChangedLines)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                          +{formatNumber(item.reviewableAdditions)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-rose-600 dark:text-rose-400">
                          -{formatNumber(item.reviewableDeletions)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatReviewCredits(item.creditsCharged)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {formatReviewCredits(item.creditBalanceAfter)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <HistoryPagination
                page={page}
                totalPages={totalPages}
                disabled={isFetching}
                onPrevious={() => setPage((p) => p - 1)}
                onNext={() => setPage((p) => p + 1)}
              />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
