import type { LucideIcon } from "lucide-react"
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"
import type { ChartConfig } from "@workspace/ui/components/chart"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@workspace/ui/components/chart"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Skeleton } from "@workspace/ui/components/skeleton"
import {
  analyticsDateTooltipLabel,
  chartAxisTick,
  chartSeriesColor,
  formatAnalyticsDate,
  pickDateTicks,
} from "./chart-utils"
import type { DateCountPoint } from "./chart-utils"

export function AreaMetricChart({
  data,
  emptyMessage,
  gradientId,
  icon: Icon,
  label,
  series,
  title,
}: {
  data: DateCountPoint[]
  emptyMessage: string
  gradientId: string
  icon: LucideIcon
  label: string
  series: 1 | 2 | 3 | 4 | 5
  title: string
}) {
  const ticks = pickDateTicks(data, 7)
  const config = {
    count: { label, color: chartSeriesColor(series) },
  } satisfies ChartConfig

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Icon className="size-4 text-muted-foreground" />
          <CardTitle className="text-sm font-medium text-foreground">
            {title}
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {data.every((point) => point.count === 0) ? (
          <div className="flex h-40 items-center justify-center">
            <p className="text-sm text-muted-foreground">{emptyMessage}</p>
          </div>
        ) : (
          <ChartContainer config={config} className="h-40 w-full">
            <AreaChart data={data} margin={{ left: -20, right: 4, top: 4 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="5%"
                    stopColor="var(--color-count)"
                    stopOpacity={0.3}
                  />
                  <stop
                    offset="95%"
                    stopColor="var(--color-count)"
                    stopOpacity={0}
                  />
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
                fill={`url(#${gradientId})`}
                dot={false}
              />
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}

export function AreaMetricChartSkeleton() {
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
