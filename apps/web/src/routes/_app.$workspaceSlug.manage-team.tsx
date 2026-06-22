import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { UnlinkIcon, UsersIcon } from "lucide-react"
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
import { PageHeader } from "@/components/page-header"
import { WorkspaceMembers } from "@/components/team/workspace-members"
import { useWorkspaceContext } from "@/contexts/workspace-context"
import { useWorkspaces } from "@/hooks/use-workspaces"
import { useLeaveWorkspace } from "@/hooks/use-leave-workspace"
import { authClient } from "@/lib/auth-client"
import { getWorkspaceSlug } from "@/lib/workspace-slug"

export const Route = createFileRoute("/_app/$workspaceSlug/manage-team")({
  component: ManageTeamRoute,
})

function ManageTeamRoute() {
  const { workspaceSlug } = Route.useParams()
  const { selectedWorkspaceId, setSelectedWorkspaceId } = useWorkspaceContext()
  const { data: workspaces } = useWorkspaces()
  const leaveWorkspace = useLeaveWorkspace()
  const { data: session } = authClient.useSession()
  const navigate = useNavigate()
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false)

  void workspaceSlug

  const selectedEntry = workspaces?.find(
    (w) => w.workspace.id === selectedWorkspaceId
  )

  const handleLeave = async () => {
    if (!selectedEntry) return

    try {
      await leaveWorkspace.mutateAsync(selectedEntry.workspace.id)
      toast.success(`Left ${selectedEntry.workspace.name}`)

      const remaining = workspaces?.filter(
        (w) => w.workspace.id !== selectedEntry.workspace.id
      )
      setSelectedWorkspaceId(remaining?.[0]?.workspace.id ?? null)
      const next = remaining?.[0]
      navigate({
        to: next ? "/$workspaceSlug/repositories" : "/connect",
        params: next
          ? { workspaceSlug: getWorkspaceSlug(next.workspace) }
          : undefined,
      })
    } catch {
      toast.error("Failed to leave workspace")
    } finally {
      setLeaveDialogOpen(false)
    }
  }

  if (!selectedWorkspaceId || !selectedEntry) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <PageHeader icon={UsersIcon} title="Manage Team" />
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-muted-foreground">
            Select an organization to manage
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader icon={UsersIcon} title="Manage Team" />

      <div className="flex-1 overflow-auto p-6">
        <div className="flex flex-col gap-6">
          {session?.user.id && (
            <WorkspaceMembers
              workspaceId={selectedWorkspaceId}
              currentUserId={session.user.id}
              currentUserRole={selectedEntry.role as "owner" | "admin" | "member"}
            />
          )}

          {selectedEntry.role !== "owner" && (
            <section className="flex flex-col gap-3 border-t border-border pt-5">
              <div className="flex items-center gap-3 rounded-lg border border-destructive/30 bg-card px-4 py-3">
                <UnlinkIcon className="size-4 shrink-0 text-destructive" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-destructive">
                    Leave workspace
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Remove yourself from this workspace. You will lose access to
                    its repositories and reviews.
                  </p>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  className="shrink-0"
                  onClick={() => setLeaveDialogOpen(true)}
                  disabled={leaveWorkspace.isPending}
                >
                  Leave workspace
                </Button>
              </div>
            </section>
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
              You will lose access to {selectedEntry.workspace.name} and its
              repositories.
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
