import { useState } from "react"
import { ExternalLinkIcon } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog"
import {
  useCancelBilling,
  usePortalBilling,
} from "@/hooks/use-workspace-billing-mutations"
import { isRedirectMutationPending } from "@/hooks/use-redirect-lock"

type Account = {
  tier: "free" | "premium" | "ultra" | "enterprise"
  creemCustomerId: string | null
  cancelAtPeriodEnd: boolean
}

export function SubscriptionActions({
  account,
  workspaceId,
  inline = false,
}: {
  account: Account
  workspaceId: string
  inline?: boolean
}) {
  const [cancelOpen, setCancelOpen] = useState(false)
  const portal = usePortalBilling(workspaceId)
  const cancel = useCancelBilling(workspaceId)

  const isPaid =
    account.tier !== "free" && account.tier !== "enterprise"
  const hasCustomer = !!account.creemCustomerId

  if (!isPaid) return null

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      {hasCustomer && (
        <Button
          variant="outline"
          size="sm"
          disabled={isRedirectMutationPending(portal)}
          onClick={() => portal.mutate()}
        >
          <ExternalLinkIcon />
          {isRedirectMutationPending(portal) ? "Opening…" : "Manage billing"}
        </Button>
      )}

      {!account.cancelAtPeriodEnd && (
        <Button
          variant="text"
          className="hover:text-destructive"
          onClick={() => setCancelOpen(true)}
        >
          Cancel subscription
        </Button>
      )}
    </div>
  )

  return (
    <>
      {inline ? (
        actions
      ) : (
        <div className="rounded-xl border bg-card p-4 shadow-sm ring-1 ring-border/50">
          {actions}
        </div>
      )}

      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel subscription?</AlertDialogTitle>
            <AlertDialogDescription>
              Your subscription will remain active until the end of the current
              billing period. Credits and access will continue until then.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancel.isPending}>
              Keep subscription
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={cancel.isPending}
              onClick={() => {
                cancel.mutate(undefined, {
                  onSuccess: () => setCancelOpen(false),
                })
              }}
            >
              {cancel.isPending ? "Cancelling…" : "Cancel subscription"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
