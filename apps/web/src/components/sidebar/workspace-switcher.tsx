"use client"

import { useState } from "react"
import {
  ChevronsUpDown,
  Plus,
  RefreshCwIcon,
  Settings2Icon,
  UnlinkIcon,
} from "lucide-react"
import { toast } from "sonner"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar"
import { Badge } from "@workspace/ui/components/badge"
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { useWorkspaces } from "@/hooks/use-workspaces"
import { useInstallUrl } from "@/hooks/use-install-url"
import { useLeaveWorkspace } from "@/hooks/use-leave-workspace"
import { useWorkspaceGithubLinks } from "@/hooks/use-workspace-github-links"
import { useWorkspaceContext } from "@/contexts/workspace-context"
import { cn } from "@workspace/ui/lib/utils"

const statusVariant = {
  active: "secondary",
  suspended: "outline",
  deleted: "destructive",
} as const

export function WorkspaceSwitcher() {
  const { selectedWorkspaceId, setSelectedWorkspaceId } = useWorkspaceContext()
  const { data: workspaces, isPending: workspacesPending } = useWorkspaces()
  const { refetch: fetchInstallUrl, isFetching: fetchingUrl } = useInstallUrl()
  const leaveWorkspace = useLeaveWorkspace()
  const { data: githubLinks } = useWorkspaceGithubLinks(selectedWorkspaceId)
  const [workspaceToLeave, setWorkspaceToLeave] = useState<{
    id: string
    name: string
  } | null>(null)

  const selectedEntry = workspaces?.find(
    (w) => w.workspace.id === selectedWorkspaceId
  )

  const handleAddOrg = async () => {
    const result = await fetchInstallUrl()
    if (result.error || !result.data?.url) {
      toast.error(
        "Failed to get GitHub install URL. Is the GitHub App configured?"
      )
      return
    }
    window.location.href = result.data.url
  }

  const handleLeave = async () => {
    if (!workspaceToLeave) return

    try {
      await leaveWorkspace.mutateAsync(workspaceToLeave.id)
      toast.success(`Left ${workspaceToLeave.name}`)

      if (selectedWorkspaceId === workspaceToLeave.id) {
        const remaining = workspaces?.filter(
          (w) => w.workspace.id !== workspaceToLeave.id
        )
        setSelectedWorkspaceId(remaining?.[0]?.workspace.id ?? null)
      }
    } catch {
      toast.error("Failed to leave workspace")
    } finally {
      setWorkspaceToLeave(null)
    }
  }

  if (workspacesPending) {
    return (
      <div className="flex w-full items-center gap-2">
        <Skeleton className="size-6 rounded-full" />
        <Skeleton className="h-4 flex-1" />
      </div>
    )
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex h-10 w-full items-center gap-2 rounded-md px-2 text-left text-sm transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            {selectedEntry ? (
              <>
                <Avatar size="sm">
                  <AvatarImage
                    src={
                      selectedEntry.workspace.providerAccountAvatarUrl ??
                      undefined
                    }
                    alt={selectedEntry.workspace.name}
                  />
                  <AvatarFallback>
                    {selectedEntry.workspace.name.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="flex-1 truncate font-medium">
                  {selectedEntry.workspace.name}
                </span>
              </>
            ) : (
              <>
                <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted">
                  <Plus className="size-3 text-muted-foreground" />
                </div>
                <span className="flex-1 text-muted-foreground">
                  Select organization
                </span>
              </>
            )}
            <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="bottom" align="start" className="w-64">
          {workspaces && workspaces.length > 0 && (
            <>
              <DropdownMenuLabel>Organizations</DropdownMenuLabel>
              {workspaces.map(({ workspace, role }) => (
                <DropdownMenuItem
                  key={workspace.id}
                  onClick={() => setSelectedWorkspaceId(workspace.id)}
                  className={cn(
                    "flex items-center gap-2",
                    workspace.id === selectedWorkspaceId && "bg-accent"
                  )}
                >
                  <Avatar size="sm">
                    <AvatarImage
                      src={workspace.providerAccountAvatarUrl ?? undefined}
                      alt={workspace.name}
                    />
                    <AvatarFallback>
                      {workspace.name.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex flex-1 flex-col gap-0.5 overflow-hidden">
                    <span className="truncate text-sm font-medium">
                      {workspace.name}
                    </span>
                    <span className="text-xs text-muted-foreground capitalize">
                      {role}
                    </span>
                  </div>
                  <Badge
                    variant={statusVariant[workspace.connectionStatus]}
                    className={cn(
                      workspace.connectionStatus === "active" &&
                        "bg-green-500/15 text-green-600 dark:text-green-400"
                    )}
                  >
                    {workspace.connectionStatus}
                  </Badge>
                </DropdownMenuItem>
              ))}
            </>
          )}

          {selectedEntry && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="truncate">
                Manage {selectedEntry.workspace.name}
              </DropdownMenuLabel>
              {githubLinks?.action === "reinstall" ||
              selectedEntry.workspace.connectionStatus === "deleted" ? (
                <DropdownMenuItem onClick={handleAddOrg} disabled={fetchingUrl}>
                  <RefreshCwIcon />
                  {fetchingUrl ? "Loading…" : "Reinstall on GitHub"}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  disabled={!githubLinks?.installationSettingsUrl}
                  onClick={() => {
                    if (githubLinks?.installationSettingsUrl) {
                      window.open(
                        githubLinks.installationSettingsUrl,
                        "_blank",
                        "noopener,noreferrer"
                      )
                    }
                  }}
                >
                  <Settings2Icon />
                  Configure on GitHub
                </DropdownMenuItem>
              )}
              {selectedEntry.role === "owner" && (
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={(event) => {
                    event.preventDefault()
                    setWorkspaceToLeave({
                      id: selectedEntry.workspace.id,
                      name: selectedEntry.workspace.name,
                    })
                  }}
                >
                  <UnlinkIcon />
                  Leave workspace
                </DropdownMenuItem>
              )}
            </>
          )}

          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={handleAddOrg}
            disabled={fetchingUrl}
            className="gap-2"
          >
            <div className="flex size-4 items-center justify-center rounded-sm border border-dashed border-border">
              <Plus className="size-3" />
            </div>
            {fetchingUrl ? "Loading…" : "Add organization"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog
        open={workspaceToLeave != null}
        onOpenChange={(open) => {
          if (!open) setWorkspaceToLeave(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave {workspaceToLeave?.name}?</AlertDialogTitle>
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
    </>
  )
}
