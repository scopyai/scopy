import { createFileRoute, useNavigate } from "@tanstack/react-router"
import {
  CreditCardIcon,
  ExternalLinkIcon,
  RefreshCwIcon,
  Settings2Icon,
  UnlinkIcon,
  UsersIcon,
} from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
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
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { PageHeader } from "@/components/page-header"
import { useWorkspaceContext } from "@/contexts/workspace-context"
import { useWorkspaces } from "@/hooks/use-workspaces"
import { useInstallUrl } from "@/hooks/use-install-url"
import { useLeaveWorkspace } from "@/hooks/use-leave-workspace"
import { useWorkspaceGithubLinks } from "@/hooks/use-workspace-github-links"

export const Route = createFileRoute("/_app/manage-team")({
  component: ManageTeamRoute,
})

function ManageTeamRoute() {
  const { selectedWorkspaceId, setSelectedWorkspaceId } = useWorkspaceContext()
  const { data: workspaces } = useWorkspaces()
  const { refetch: fetchInstallUrl, isFetching: fetchingUrl } = useInstallUrl()
  const leaveWorkspace = useLeaveWorkspace()
  const { data: githubLinks } = useWorkspaceGithubLinks(selectedWorkspaceId)
  const navigate = useNavigate()
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false)

  const selectedEntry = workspaces?.find(
    (w) => w.workspace.id === selectedWorkspaceId
  )

  const handleConfigureGitHub = async () => {
    if (
      githubLinks?.action === "reinstall" ||
      selectedEntry?.workspace.connectionStatus === "deleted"
    ) {
      const result = await fetchInstallUrl()
      if (result.error || !result.data?.url) {
        toast.error(
          "Failed to get GitHub install URL. Is the GitHub App configured?"
        )
        return
      }
      window.location.href = result.data.url
    } else if (githubLinks?.installationSettingsUrl) {
      window.open(
        githubLinks.installationSettingsUrl,
        "_blank",
        "noopener,noreferrer"
      )
    }
  }

  const handleLeave = async () => {
    if (!selectedEntry) return

    try {
      await leaveWorkspace.mutateAsync(selectedEntry.workspace.id)
      toast.success(`Left ${selectedEntry.workspace.name}`)

      const remaining = workspaces?.filter(
        (w) => w.workspace.id !== selectedEntry.workspace.id
      )
      setSelectedWorkspaceId(remaining?.[0]?.workspace.id ?? null)
      navigate({ to: "/dashboard" })
    } catch {
      toast.error("Failed to leave workspace")
    } finally {
      setLeaveDialogOpen(false)
    }
  }

  if (!selectedWorkspaceId || !selectedEntry) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">
          Select an organization to manage
        </p>
      </div>
    )
  }

  const isReinstall =
    githubLinks?.action === "reinstall" ||
    selectedEntry.workspace.connectionStatus === "deleted"

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader icon={UsersIcon} title="Manage Team" />

      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto flex max-w-2xl flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <CreditCardIcon className="size-4 text-muted-foreground" />
                Billing
              </CardTitle>
              <CardDescription>
                Manage your subscription, payment methods, and invoices.
              </CardDescription>
            </CardHeader>
            <CardFooter>
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate({ to: "/billing" })}
              >
                Go to Billing
              </Button>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Settings2Icon className="size-4 text-muted-foreground" />
                GitHub Configuration
              </CardTitle>
              <CardDescription>
                {isReinstall
                  ? "The GitHub App installation needs to be reinstalled."
                  : "Manage repository access and permissions on GitHub."}
              </CardDescription>
            </CardHeader>
            <CardFooter>
              <Button
                variant="outline"
                size="sm"
                onClick={handleConfigureGitHub}
                disabled={
                  fetchingUrl ||
                  (!isReinstall && !githubLinks?.installationSettingsUrl)
                }
              >
                {isReinstall ? (
                  <>
                    <RefreshCwIcon className="size-3.5" />
                    {fetchingUrl ? "Loading…" : "Reinstall on GitHub"}
                  </>
                ) : (
                  <>
                    <ExternalLinkIcon className="size-3.5" />
                    Configure on GitHub
                  </>
                )}
              </Button>
            </CardFooter>
          </Card>

          {selectedEntry.role === "owner" && (
            <Card className="border-destructive/30">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base text-destructive">
                  <UnlinkIcon className="size-4" />
                  Leave Workspace
                </CardTitle>
                <CardDescription>
                  Remove this workspace from your dashboard. The GitHub App
                  installation will remain active.
                </CardDescription>
              </CardHeader>
              <CardFooter>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setLeaveDialogOpen(true)}
                  disabled={leaveWorkspace.isPending}
                >
                  Leave workspace
                </Button>
              </CardFooter>
            </Card>
          )}
        </div>
      </div>

      <AlertDialog open={leaveDialogOpen} onOpenChange={setLeaveDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Leave {selectedEntry.workspace.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This removes the workspace from your dashboard. The GitHub App
              installation will remain active.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={leaveWorkspace.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={leaveWorkspace.isPending}
              onClick={handleLeave}
            >
              {leaveWorkspace.isPending ? "Leaving…" : "Leave workspace"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
