import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Skeleton } from "@workspace/ui/components/skeleton"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@workspace/ui/components/chart"
import { GitPullRequestIcon } from "lucide-react"
import {
  analyticsDateTooltipLabel,
  chartAxisTick,
  chartSeriesColor,
  formatAnalyticsDate,
} from "./chart-utils"

type DataPoint = { date: string; count: number }

const chartConfig = {
  count: {
    label: "PR Reviews",
    color: chartSeriesColor(1),
  },
} satisfies ChartConfig

function pickXAxisTicks(data: DataPoint[]): string[] {
  if (data.length <= 7) return data.map((d) => d.date)
  const step = Math.ceil(data.length / 7)
  return data.filter((_, i) => i % step === 0 || i === data.length - 1).map((d) => d.date)
}

export function PrReviewsChart({ data }: { data: DataPoint[] }) {
  const ticks = pickXAxisTicks(data)
  const isEmpty = data.every((d) => d.count === 0)

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <GitPullRequestIcon className="size-4 text-muted-foreground" />
          <CardTitle className="text-sm font-medium text-foreground">
            PR Reviews over time
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {isEmpty ? (
          <div className="flex h-40 items-center justify-center">
            <p className="text-sm text-muted-foreground">No reviews in this period</p>
          </div>
        ) : (
          <ChartContainer config={chartConfig} className="h-40 w-full">
            <AreaChart data={data} margin={{ left: -20, right: 4, top: 4 }}>
              <defs>
                <linearGradient id="fillPrReviews" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-count)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="var(--color-count)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis
                dataKey="date"
                ticks={ticks}
                tickFormatter={formatAnalyticsDate}
                tickLine={false}
                axisLine={false}
                tick={chartAxisTick}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tick={chartAxisTick}
                allowDecimals={false}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={analyticsDateTooltipLabel}
                  />
                }
              />
              <Area
                type="monotone"
                dataKey="count"
                stroke="var(--color-count)"
                strokeWidth={2}
                fill="url(#fillPrReviews)"
                dot={false}
              />
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}

export function PrReviewsChartSkeleton() {
  return (
    <Card>
      <CardHeader className="pb-2">
        <Skeleton className="h-4 w-44" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-40 w-full" />
      </CardContent>
    </Card>
  )
}
