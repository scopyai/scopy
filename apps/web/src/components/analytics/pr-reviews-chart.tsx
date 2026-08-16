import { GitPullRequestIcon } from "lucide-react"
import {
  AreaMetricChart,
  AreaMetricChartSkeleton,
} from "./area-metric-chart"
import type { DateCountPoint } from "./chart-utils"

export function PrReviewsChart({ data }: { data: DateCountPoint[] }) {
  return (
    <AreaMetricChart
      data={data}
      emptyMessage="No reviews in this period"
      gradientId="fillPrReviews"
      icon={GitPullRequestIcon}
      label="PR Reviews"
      series={1}
      title="PR Reviews over time"
    />
  )
}

export const PrReviewsChartSkeleton = AreaMetricChartSkeleton
