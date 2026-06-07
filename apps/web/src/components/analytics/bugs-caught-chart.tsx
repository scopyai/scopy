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
import { BugIcon } from "lucide-react"
import { chartAxisTick, chartSeriesColor } from "./chart-utils"

type DataPoint = { date: string; count: number }

const chartConfig = {
  count: {
    label: "Bugs Caught",
    color: chartSeriesColor(2),
  },
} satisfies ChartConfig

function formatDate(date: string) {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })
}

function pickXAxisTicks(data: DataPoint[]): string[] {
  if (data.length <= 7) return data.map((d) => d.date)
  const step = Math.ceil(data.length / 7)
  return data.filter((_, i) => i % step === 0 || i === data.length - 1).map((d) => d.date)
}

export function BugsCaughtChart({ data }: { data: DataPoint[] }) {
  const ticks = pickXAxisTicks(data)
  const isEmpty = data.every((d) => d.count === 0)

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <BugIcon className="size-4 text-muted-foreground" />
          <CardTitle className="text-sm font-medium text-foreground">
            Bugs caught over time
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {isEmpty ? (
          <div className="flex h-40 items-center justify-center">
            <p className="text-sm text-muted-foreground">No bugs caught in this period</p>
          </div>
        ) : (
          <ChartContainer config={chartConfig} className="h-40 w-full">
            <AreaChart data={data} margin={{ left: -20, right: 4, top: 4 }}>
              <defs>
                <linearGradient id="fillBugsCaught" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-count)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="var(--color-count)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} strokeDasharray="3 3" />
              <XAxis
                dataKey="date"
                ticks={ticks}
                tickFormatter={formatDate}
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
                    labelFormatter={(v) => formatDate(String(v))}
                  />
                }
              />
              <Area
                type="monotone"
                dataKey="count"
                stroke="var(--color-count)"
                strokeWidth={2}
                fill="url(#fillBugsCaught)"
                dot={false}
              />
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}

export function BugsCaughtChartSkeleton() {
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
