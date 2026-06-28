import { SparklesIcon } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { useStarterCheckout } from "@/hooks/use-workspace-billing-mutations"

export function StarterCard({
  isOwner,
  workspaceId,
}: {
  isOwner: boolean
  workspaceId: string
}) {
  const starter = useStarterCheckout(workspaceId)

  return (
    <div className="relative flex flex-col gap-4 overflow-hidden rounded-xl border border-primary/40 bg-card p-6 shadow-sm ring-1 ring-primary/15 sm:flex-row sm:items-center sm:justify-between">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/[0.06] via-transparent to-transparent" />

      <div className="relative flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <SparklesIcon className="size-4 text-primary" />
          <h3 className="text-base font-semibold">Try Scopy for $1</h3>
        </div>
        <p className="max-w-xl text-sm text-muted-foreground">
          Scopy is a paid product. Add a card and a one-time $1 unlocks usage
          for this workspace so you can try real reviews on your pull requests.
          Upgrade to a monthly plan whenever you're ready.
        </p>
      </div>

      <Button
        className="relative shrink-0"
        disabled={!isOwner || starter.isPending}
        onClick={() => starter.mutate()}
      >
        {starter.isPending
          ? "Redirecting…"
          : isOwner
            ? "Start for $1"
            : "Owner only"}
      </Button>
    </div>
  )
}
