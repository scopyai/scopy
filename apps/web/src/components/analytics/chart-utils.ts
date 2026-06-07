export const chartAxisTick = {
  fontSize: 11,
  fill: "var(--muted-foreground)",
} as const

export function chartSeriesColor(chart: 1 | 2 | 3 | 4 | 5): string {
  return `var(--chart-${chart})`
}
