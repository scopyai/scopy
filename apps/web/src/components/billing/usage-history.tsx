import { Fragment, useState } from "react"
import { ChevronDownIcon } from "lucide-react"
import { Badge } from "@workspace/ui/components/badge"
import { Skeleton } from "@workspace/ui/components/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import { cn } from "@workspace/ui/lib/utils"
import {
  useWorkspaceBillingUsage,
  useWorkspaceUsageTrend,
} from "@/hooks/use-workspace-billing-usage"
import {
  formatBillingMode,
  formatBytes,
  formatDate,
  formatUsageBalance,
} from "@/lib/billing-format"
import { tagToneClassName } from "@/lib/tag-tones"
import { HistoryPagination } from "./history-pagination"
import { UsageTrendChart } from "./usage-trend-chart"

const PAGE_SIZE = 25

type UsageItem = NonNullable<
  ReturnType<typeof useWorkspaceBillingUsage>["data"]
>["items"][number]

function modelBadges(item: UsageItem) {
  const ids = new Set<string>()
  for (const model of item.models) {
    if (model.modelId && model.modelId !== "unknown") ids.add(model.modelId)
  }
  if (ids.size === 0 && item.modelId) ids.add(item.modelId)
  return Array.from(ids)
}

function shortModel(modelId: string) {
  const parts = modelId.split("/")
  return parts.at(-1) || modelId
}

function UsageBreakdown({ item }: { item: UsageItem }) {
  const vectorTotal =
    item.vectorWriteCostMicrocents +
    item.vectorQueryCostMicrocents +
    item.vectorNetworkCostMicrocents

  return (
    <div className="grid gap-5 bg-muted/30 px-4 py-4 text-sm md:grid-cols-[1.2fr_1fr]">
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Model costs
        </span>
        <div className="flex flex-col gap-1">
          {item.models.length === 0 ? (
            <span className="text-muted-foreground">No model usage recorded</span>
          ) : (
            item.models.map((model, index) => (
              <div
                key={`${model.stage}-${index}`}
                className="flex items-center justify-between gap-4"
              >
                <span className="text-muted-foreground">
                  <span className="text-foreground">
                    {shortModel(model.modelId)}
                  </span>{" "}
                  · {model.stage}
                  {model.provider ? ` · ${model.provider}` : ""}
                </span>
                <span className="tabular-nums">
                  {formatUsageBalance(model.costMicrocents)}
                </span>
              </div>
            ))
          )}
          <div className="mt-1 flex items-center justify-between gap-4 border-t pt-1">
            <span className="text-muted-foreground">LLM subtotal</span>
            <span className="tabular-nums">
              {formatUsageBalance(item.llmCostMicrocents)}
            </span>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Embeddings &amp; vector search
        </span>
        {vectorTotal === 0 ? (
          <span className="text-muted-foreground">
            No vector indexing for this review
          </span>
        ) : (
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">
                Index writes · {formatBytes(item.vectorWriteBytes)}
              </span>
              <span className="tabular-nums">
                {formatUsageBalance(item.vectorWriteCostMicrocents)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">
                Queries · {item.vectorQueryCount.toLocaleString("en-US")}
              </span>
              <span className="tabular-nums">
                {formatUsageBalance(item.vectorQueryCostMicrocents)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">
                Network · {formatBytes(item.vectorNetworkBytes)}
              </span>
              <span className="tabular-nums">
                {formatUsageBalance(item.vectorNetworkCostMicrocents)}
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1 border-t pt-4 md:col-span-2">
        <div className="flex items-center justify-between gap-4 font-medium">
          <span>Total charged</span>
          <span className="tabular-nums">
            {formatUsageBalance(item.totalCostMicrocents)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4 text-muted-foreground">
          <span>Deducted from</span>
          <span>
            {item.billingMode === "byok"
              ? `Own ${item.provider ?? ""} key${
                  item.keyPreview ? ` · ${item.keyPreview}` : ""
                }`
              : "Plan balance"}
          </span>
        </div>
        {item.billingMode === "platform" && item.balanceAfter !== null ? (
          <div className="flex items-center justify-between gap-4 text-muted-foreground">
            <span>Balance after</span>
            <span className="tabular-nums">
              {formatUsageBalance(item.balanceAfter)}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function UsageHistory({
  workspaceId,
}: {
  workspaceId: string | null | undefined
}) {
  const [page, setPage] = useState(1)
  const [expanded, setExpanded] = useState<string | null>(null)
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
            Cost breakdown for each review Scopy ran
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
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Date</TableHead>
                    <TableHead>Review</TableHead>
                    <TableHead>Models</TableHead>
                    <TableHead>Deducted from</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((item) => {
                    const isOpen = expanded === item.id
                    const badges = modelBadges(item)
                    return (
                      <Fragment key={item.id}>
                        <TableRow
                          className="cursor-pointer"
                          aria-expanded={isOpen}
                          onClick={() =>
                            setExpanded(isOpen ? null : item.id)
                          }
                        >
                          <TableCell>
                            <ChevronDownIcon
                              className={cn(
                                "size-4 text-muted-foreground transition-transform",
                                isOpen ? "" : "-rotate-90",
                              )}
                            />
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-muted-foreground">
                            {formatDate(item.createdAt)}
                          </TableCell>
                          <TableCell className="max-w-64">
                            {item.repositoryName ? (
                              <div className="flex flex-col">
                                <span className="truncate font-medium">
                                  {item.repositoryName}
                                  {item.pullRequestNumber
                                    ? ` #${item.pullRequestNumber}`
                                    : ""}
                                </span>
                                {item.pullRequestTitle ? (
                                  <span className="truncate text-xs text-muted-foreground">
                                    {item.pullRequestTitle}
                                  </span>
                                ) : null}
                              </div>
                            ) : (
                              <span className="text-muted-foreground">
                                Review
                              </span>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {badges.slice(0, 2).map((modelId) => (
                                <Badge
                                  key={modelId}
                                  variant="outline"
                                  className={tagToneClassName(modelId)}
                                >
                                  {shortModel(modelId)}
                                </Badge>
                              ))}
                              {badges.length > 2 ? (
                                <Badge
                                  variant="outline"
                                  className={tagToneClassName("default")}
                                >
                                  +{badges.length - 2}
                                </Badge>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={tagToneClassName(item.billingMode)}
                            >
                              {item.billingMode === "byok" && item.keyPreview
                                ? item.keyPreview
                                : formatBillingMode(item.billingMode)}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatUsageBalance(item.totalCostMicrocents)}
                          </TableCell>
                        </TableRow>
                        {isOpen ? (
                          <TableRow className="hover:bg-transparent">
                            <TableCell colSpan={6} className="p-0">
                              <UsageBreakdown item={item} />
                            </TableCell>
                          </TableRow>
                        ) : null}
                      </Fragment>
                    )
                  })}
                </TableBody>
              </Table>

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
