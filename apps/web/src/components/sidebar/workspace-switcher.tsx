"use client"

import { ChevronsUpDown, Plus } from "lucide-react"
import { useNavigate } from "@tanstack/react-router"
import { toast } from "sonner"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar"
import { Badge } from "@workspace/ui/components/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { useWorkspaces } from "@/hooks/use-workspaces"
import { useInstallUrl } from "@/hooks/use-install-url"
import { useWorkspaceContext } from "@/contexts/workspace-context"
import {
  getWorkspaceSlug,
  getActiveWorkspaces,
  getPendingWorkspaces,
} from "@/lib/workspace-slug"
import { cn } from "@workspace/ui/lib/utils"
import { PendingWorkspaceInvitations } from "./pending-workspace-invitations"

const statusVariant = {
  active: "secondary",
  suspended: "outline",
  deleted: "destructive",
} as const

export function WorkspaceSwitcher() {
  const { selectedWorkspaceId } = useWorkspaceContext()
  const { data: workspaces, isPending: workspacesPending } = useWorkspaces()
  const { refetch: fetchInstallUrl, isFetching: fetchingUrl } = useInstallUrl()
  const navigate = useNavigate()

  const active = getActiveWorkspaces(workspaces)
  const pending = getPendingWorkspaces(workspaces)

  const selectedEntry = active.find(
    (w) => w.workspace.id === selectedWorkspaceId
  )

  const handleSelectWorkspace = (workspaceId: string) => {
    const entry = active.find((w) => w.workspace.id === workspaceId)
    if (!entry) return

    navigate({
      to: "/$workspaceSlug/repositories",
      params: { workspaceSlug: getWorkspaceSlug(entry.workspace) },
    })
  }

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

  if (workspacesPending) {
    return (
      <div className="flex w-full items-center gap-2">
        <Skeleton className="size-6 rounded-full" />
        <Skeleton className="h-4 flex-1" />
      </div>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex h-11 w-full items-center gap-2 rounded-md px-2 text-left text-base transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
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
      <DropdownMenuContent side="bottom" align="start" sideOffset={4}>
        {active.map(({ workspace, role }) => (
          <DropdownMenuItem
            key={workspace.id}
            onClick={() => handleSelectWorkspace(workspace.id)}
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
              <span className="truncate text-base font-medium">
                {workspace.name}
              </span>
              <span className="text-sm text-muted-foreground capitalize">
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

        {pending.length > 0 && (
          <>
            {active.length > 0 && <DropdownMenuSeparator />}
            <PendingWorkspaceInvitations pending={pending} />
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
          {fetchingUrl ? "Loading…" : "Add workspace"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
