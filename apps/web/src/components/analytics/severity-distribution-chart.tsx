import { Cell, Pie, PieChart } from "recharts"
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
import { ShieldAlertIcon } from "lucide-react"

type SeverityItem = {
  severity: "critical" | "high" | "medium" | "low"
  count: number
}

const severityColor: Record<SeverityItem["severity"], string> = {
  critical: "hsl(0 72% 51%)",
  high: "hsl(25 95% 53%)",
  medium: "hsl(48 96% 53%)",
  low: "hsl(217 91% 60%)",
}

const severityLabel: Record<SeverityItem["severity"], string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
}

const severityOrder: SeverityItem["severity"][] = ["critical", "high", "medium", "low"]

const chartConfig = {
  critical: { label: "Critical", color: severityColor.critical },
  high: { label: "High", color: severityColor.high },
  medium: { label: "Medium", color: severityColor.medium },
  low: { label: "Low", color: severityColor.low },
} satisfies ChartConfig

export function SeverityDistributionChart({ data }: { data: SeverityItem[] }) {
  const ordered = severityOrder
    .map((s) => data.find((d) => d.severity === s))
    .filter((d): d is SeverityItem => !!d && d.count > 0)

  const total = ordered.reduce((sum, d) => sum + d.count, 0)
  const isEmpty = total === 0

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <ShieldAlertIcon className="size-4 text-muted-foreground" />
          <CardTitle className="text-sm font-medium text-foreground">
            Issue severity distribution
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {isEmpty ? (
          <div className="flex h-44 items-center justify-center">
            <p className="text-sm text-muted-foreground">No issues found in this period</p>
          </div>
        ) : (
          <div className="flex items-center gap-6">
            <ChartContainer config={chartConfig} className="h-44 w-44 shrink-0">
              <PieChart>
                <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                <Pie
                  data={ordered}
                  dataKey="count"
                  nameKey="severity"
                  innerRadius={44}
                  outerRadius={70}
                  paddingAngle={2}
                >
                  {ordered.map((entry) => (
                    <Cell
                      key={entry.severity}
                      fill={severityColor[entry.severity]}
                    />
                  ))}
                </Pie>
              </PieChart>
            </ChartContainer>

            <div className="flex flex-col gap-2">
              {ordered.map((item) => (
                <div key={item.severity} className="flex items-center gap-2">
                  <div
                    className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                    style={{ backgroundColor: severityColor[item.severity] }}
                  />
                  <span className="text-sm text-muted-foreground">
                    {severityLabel[item.severity]}
                  </span>
                  <span className="ml-auto pl-4 text-sm font-medium tabular-nums text-foreground">
                    {item.count.toLocaleString()}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {Math.round((item.count / total) * 100)}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function SeverityDistributionChartSkeleton() {
  return (
    <Card>
      <CardHeader className="pb-2">
        <Skeleton className="h-4 w-48" />
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-6">
          <Skeleton className="h-44 w-44 shrink-0 rounded-full" />
          <div className="flex flex-col gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-4 w-32" />
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
