import { createFileRoute } from "@tanstack/react-router"
import { BarChart3Icon } from "lucide-react"
import { PageHeader } from "@/components/page-header"

export const Route = createFileRoute("/_app/$workspaceSlug/analytics")({
  component: AnalyticsRoute,
})

function AnalyticsRoute() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader icon={BarChart3Icon} title="Analytics" />

      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">Coming soon</p>
      </div>
    </div>
  )
}
