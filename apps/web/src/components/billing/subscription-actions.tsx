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
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  useCancelBilling,
  usePortalBilling,
} from "@/hooks/use-workspace-billing-mutations"

type Account = {
  tier: "free" | "premium" | "ultra" | "enterprise"
  creemCustomerId: string | null
  cancelAtPeriodEnd: boolean
}

export function SubscriptionActions({
  account,
  workspaceId,
}: {
  account: Account
  workspaceId: string
}) {
  const [cancelOpen, setCancelOpen] = useState(false)
  const portal = usePortalBilling(workspaceId)
  const cancel = useCancelBilling(workspaceId)

  const isPaid =
    account.tier !== "free" && account.tier !== "enterprise"
  const hasCustomer = !!account.creemCustomerId

  if (!isPaid) return null

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Subscription management</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {hasCustomer && (
            <Button
              variant="outline"
              size="sm"
              disabled={portal.isPending}
              onClick={() => portal.mutate()}
            >
              <ExternalLinkIcon />
              {portal.isPending ? "Opening…" : "Manage billing"}
            </Button>
          )}

          {!account.cancelAtPeriodEnd && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setCancelOpen(true)}
            >
              Cancel subscription
            </Button>
          )}
        </CardContent>
      </Card>

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
                cancel.mutate(undefined, { onSuccess: () => setCancelOpen(false) })
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
