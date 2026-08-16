import { BugIcon } from "lucide-react"
import {
  AreaMetricChart,
  AreaMetricChartSkeleton,
} from "./area-metric-chart"
import type { DateCountPoint } from "./chart-utils"

export function BugsCaughtChart({ data }: { data: DateCountPoint[] }) {
  return (
    <AreaMetricChart
      data={data}
      emptyMessage="No bugs caught in this period"
      gradientId="fillBugsCaught"
      icon={BugIcon}
      label="Bugs Caught"
      series={2}
      title="Bugs caught over time"
    />
  )
}

export const BugsCaughtChartSkeleton = AreaMetricChartSkeleton
