import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import type { WorkspaceAnalyticsRange } from "@/hooks/use-workspace-analytics"

const rangeLabels: Record<WorkspaceAnalyticsRange, string> = {
  this_week: "This week",
  this_month: "This month",
  last_30_days: "Last 30 days",
  last_90_days: "Last 90 days",
  all_time: "All time",
}

const rangeOrder: WorkspaceAnalyticsRange[] = [
  "this_week",
  "this_month",
  "last_30_days",
  "last_90_days",
  "all_time",
]

interface AnalyticsRangeSelectProps {
  value: WorkspaceAnalyticsRange
  onChange: (range: WorkspaceAnalyticsRange) => void
}

export function AnalyticsRangeSelect({
  value,
  onChange,
}: AnalyticsRangeSelectProps) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-36">
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="start">
        {rangeOrder.map((range) => (
          <SelectItem key={range} value={range}>
            {rangeLabels[range]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
