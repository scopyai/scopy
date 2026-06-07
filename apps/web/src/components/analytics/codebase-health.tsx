import { Bar, BarChart, XAxis, YAxis } from "recharts"
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
import { FileWarningIcon, CodeIcon } from "lucide-react"
import { chartAxisTick, chartSeriesColor } from "./chart-utils"

type FlaggedFile = {
  repositoryId: string
  repositoryFullName: string
  file: string
  count: number
}

type BugProneLanguage = {
  language: string
  count: number
}

const langChartConfig = {
  count: {
    label: "Issues",
    color: chartSeriesColor(4),
  },
} satisfies ChartConfig

function shortenFilePath(file: string): string {
  const parts = file.split("/")
  if (parts.length <= 3) return file
  return `.../${parts.slice(-2).join("/")}`
}

export function MostFlaggedFiles({ data }: { data: FlaggedFile[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <FileWarningIcon className="size-4 text-muted-foreground" />
          <CardTitle className="text-sm font-medium text-foreground">
            Most flagged files
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <div className="flex h-32 items-center justify-center">
            <p className="text-sm text-muted-foreground">No flagged files in this period</p>
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-border">
            {data.slice(0, 8).map((f, i) => (
              <div key={i} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p
                    className="truncate font-mono text-sm text-foreground"
                    title={f.file}
                  >
                    {shortenFilePath(f.file)}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {f.repositoryFullName}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-medium tabular-nums text-foreground">
                  {f.count}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function MostFlaggedFilesSkeleton() {
  return (
    <Card>
      <CardHeader className="pb-2">
        <Skeleton className="h-4 w-36" />
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

export function BugProneLanguagesChart({ data }: { data: BugProneLanguage[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <CodeIcon className="size-4 text-muted-foreground" />
          <CardTitle className="text-sm font-medium text-foreground">
            Bug-prone languages
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <div className="flex h-44 items-center justify-center">
            <p className="text-sm text-muted-foreground">No data in this period</p>
          </div>
        ) : (
          <ChartContainer config={langChartConfig} className="h-44 w-full">
            <BarChart
              layout="vertical"
              data={data.slice(0, 8)}
              margin={{ left: 4, right: 4, top: 4 }}
            >
              <XAxis
                type="number"
                tickLine={false}
                axisLine={false}
                tick={chartAxisTick}
                allowDecimals={false}
              />
              <YAxis
                type="category"
                dataKey="language"
                tickLine={false}
                axisLine={false}
                tick={chartAxisTick}
                width={72}
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar
                dataKey="count"
                fill="var(--color-count)"
                radius={[0, 2, 2, 0]}
                maxBarSize={14}
              />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}

export function BugProneLanguagesChartSkeleton() {
  return (
    <Card>
      <CardHeader className="pb-2">
        <Skeleton className="h-4 w-36" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-44 w-full" />
      </CardContent>
    </Card>
  )
}
