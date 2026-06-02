import { createFileRoute } from "@tanstack/react-router"
import { Settings2Icon } from "lucide-react"
import { PageHeader } from "@/components/page-header"

export const Route = createFileRoute("/_app/settings")({
  component: SettingsRoute,
})

function SettingsRoute() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader icon={Settings2Icon} title="Review settings" />

      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">Coming soon</p>
      </div>
    </div>
  )
}
