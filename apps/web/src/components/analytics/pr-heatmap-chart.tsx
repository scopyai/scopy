import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
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
import { CalendarIcon } from "lucide-react"
import {
  analyticsDateTooltipLabel,
  chartAxisTick,
  chartSeriesColor,
  formatAnalyticsDate,
} from "./chart-utils"

type DataPoint = { date: string; count: number }

const chartConfig = {
  count: {
    label: "PRs Opened",
    color: chartSeriesColor(3),
  },
} satisfies ChartConfig

function pickXAxisTicks(data: DataPoint[]): string[] {
  if (data.length <= 10) return data.map((d) => d.date)
  const step = Math.ceil(data.length / 10)
  return data.filter((_, i) => i % step === 0 || i === data.length - 1).map((d) => d.date)
}

export function PrHeatmapChart({ data }: { data: DataPoint[] }) {
  const ticks = pickXAxisTicks(data)
  const isEmpty = data.every((d) => d.count === 0)

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <CalendarIcon className="size-4 text-muted-foreground" />
          <CardTitle className="text-sm font-medium text-foreground">
            PR activity by day
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {isEmpty ? (
          <div className="flex h-36 items-center justify-center">
            <p className="text-sm text-muted-foreground">No PR activity in this period</p>
          </div>
        ) : (
          <ChartContainer config={chartConfig} className="h-36 w-full">
            <BarChart data={data} margin={{ left: -20, right: 4, top: 4 }}>
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
              <Bar
                dataKey="count"
                fill="var(--color-count)"
                radius={[2, 2, 0, 0]}
                maxBarSize={16}
              />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}

export function PrHeatmapChartSkeleton() {
  return (
    <Card>
      <CardHeader className="pb-2">
        <Skeleton className="h-4 w-40" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-36 w-full" />
      </CardContent>
    </Card>
  )
}
