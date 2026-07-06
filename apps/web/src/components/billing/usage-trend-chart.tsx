import { useMemo } from "react"
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"
import type { ChartConfig } from "@workspace/ui/components/chart"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@workspace/ui/components/chart"

type TrendPoint = {
  date: string
  creditsCharged: number
  reviewCount: number
}

const chartConfig = {
  credits: {
    label: "Credits",
    color: "var(--primary)",
  },
} satisfies ChartConfig

const formatAxisDate = (value: string) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(value))

export function UsageTrendChart({ points }: { points: TrendPoint[] }) {
  const data = useMemo(
    () =>
      points.map((point) => ({
        date: point.date,
        credits: point.creditsCharged,
        reviewCount: point.reviewCount,
      })),
    [points]
  )

  return (
    <div className="flex flex-col gap-4 rounded-lg border bg-card px-4 py-4">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-sm font-medium">Credits over time</h3>
        <p className="text-xs text-muted-foreground">
          Daily review credits over the last 30 days
        </p>
      </div>
      {data.length === 0 ? (
        <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
          No usage in the last 30 days
        </div>
      ) : (
        <ChartContainer config={chartConfig} className="h-40 w-full">
          <AreaChart data={data} margin={{ left: 4, right: 4, top: 4 }}>
            <defs>
              <linearGradient id="fillCredits" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor="var(--color-credits)"
                  stopOpacity={0.35}
                />
                <stop
                  offset="95%"
                  stopColor="var(--color-credits)"
                  stopOpacity={0.02}
                />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={24}
              tickFormatter={formatAxisDate}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={48}
              tickFormatter={(value: number) =>
                `${value.toLocaleString("en-US", {
                  maximumFractionDigits: 0,
                })}`
              }
            />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelFormatter={(value) => formatAxisDate(String(value))}
                  formatter={(value) => [
                    Number(value).toLocaleString("en-US"),
                    " Credits",
                  ]}
                />
              }
            />
            <Area
              dataKey="credits"
              type="monotone"
              fill="url(#fillCredits)"
              stroke="var(--color-credits)"
              strokeWidth={2}
            />
          </AreaChart>
        </ChartContainer>
      )}
    </div>
  )
}
