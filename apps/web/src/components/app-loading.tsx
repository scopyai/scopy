import { Spinner } from "@workspace/ui/components/spinner"
import { cn } from "@workspace/ui/lib/utils"

export function AppLoading({
  fullScreen = false,
  label = "Loading dashboard...",
}: {
  fullScreen?: boolean
  label?: string
}) {
  return (
    <div
      aria-busy="true"
      className={cn(
        "flex items-center justify-center p-4",
        fullScreen ? "h-svh" : "h-full min-h-40"
      )}
    >
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="size-5" />
        <span>{label}</span>
      </div>
    </div>
  )
}
