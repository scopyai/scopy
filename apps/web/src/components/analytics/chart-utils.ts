export const chartAxisTick = {
  fontSize: 11,
  fill: "var(--muted-foreground)",
} as const

const analyticsChartPalette = [
  "#5B82FF",
  "#6E6BFF",
  "#8B5CF6",
  "#3B9CFF",
  "#36B6D8",
] as const

export function chartSeriesColor(chart: 1 | 2 | 3 | 4 | 5): string {
  return analyticsChartPalette[chart - 1]
}

export function formatAnalyticsDate(date: string) {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })
}

type DailyChartPayload = ReadonlyArray<{ payload?: { date?: string } }>

export function analyticsDateTooltipLabel(
  label: unknown,
  payload: DailyChartPayload | undefined,
) {
  const date =
    (typeof label === "string" ? label : undefined) ??
    payload?.[0]?.payload?.date

  return date ? formatAnalyticsDate(date) : ""
}
