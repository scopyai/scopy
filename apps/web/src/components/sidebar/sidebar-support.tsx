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
import { toast } from "sonner"

const supportEmail = "support@scopy.dev"

export function SidebarSupport() {
  async function handleCopyEmail() {
    try {
      await navigator.clipboard.writeText(supportEmail)
      toast.success("Email copied to clipboard")
    } catch {
      toast.error("Failed to copy email")
    }
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" className="w-full">
          Support
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="sm:max-w-sm">
        <AlertDialogHeader>
          <AlertDialogTitle>Support</AlertDialogTitle>
          <AlertDialogDescription>
            You can submit feedback using the input above. If you have any
            problems, reach us at{" "}
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
