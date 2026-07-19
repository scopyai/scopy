import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@workspace/ui/components/alert-dialog"
import { Button } from "@workspace/ui/components/button"
import { LifeBuoyIcon } from "lucide-react"
import { toast } from "sonner"
import type { ReactElement } from "react"

const supportEmail = "support@scopy.dev"

interface SupportDialogProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  trigger?: ReactElement
}

export function SupportDialog({
  open,
  onOpenChange,
  trigger,
}: SupportDialogProps) {
  async function handleCopyEmail() {
    try {
      await navigator.clipboard.writeText(supportEmail)
      toast.success("Email copied to clipboard")
    } catch {
      toast.error("Failed to copy email")
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      {trigger && <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>}
      <AlertDialogContent className="sm:max-w-sm">
        <AlertDialogHeader>
          <AlertDialogTitle>Support</AlertDialogTitle>
          <AlertDialogDescription>
            If you need help, reach us at{" "}
            <button
              type="button"
              onClick={handleCopyEmail}
              className="underline underline-offset-3 hover:text-foreground"
            >
              {supportEmail}
            </button>{" "}
            and we will respond soon.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="sm:justify-center">
          <AlertDialogAction>Got it</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function SidebarSupport() {
  return (
    <SupportDialog
      trigger={
        <Button
          variant="outline"
          size="sm"
          className="sidebar-item w-full"
          title="Support"
        >
          <LifeBuoyIcon className="sidebar-collapsed-only hidden" />
          <span className="sidebar-copy">Support</span>
        </Button>
      }
    />
  )
}
