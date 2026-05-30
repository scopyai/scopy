"use client"

import { ChevronsUpDown, Plus, CheckIcon } from "lucide-react"
import { toast } from "sonner"
import { Avatar, AvatarFallback, AvatarImage } from "@workspace/ui/components/avatar"
import { Badge } from "@workspace/ui/components/badge"
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

  const selectedWorkspace = workspaces?.find(
    (w) => w.workspace.id === selectedWorkspaceId
  )

  const handleAddOrg = async () => {
    const result = await fetchInstallUrl()
    if (result.error || !result.data?.url) {
      toast.error("Failed to get GitHub install URL. Is the GitHub App configured?")
      return
    }
    window.location.href = result.data.url
  }

  if (workspacesPending) {
    return (
      <div className="flex items-center gap-2 p-2">
        <Skeleton className="size-7 rounded-full" />
        <Skeleton className="h-4 w-28" />
      </div>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex w-full items-center gap-2 rounded-md p-2 text-left text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {selectedWorkspace ? (
            <>
              <Avatar size="sm">
                <AvatarImage
                  src={selectedWorkspace.workspace.providerAccountAvatarUrl ?? undefined}
                  alt={selectedWorkspace.workspace.name}
                />
                <AvatarFallback>
                  {selectedWorkspace.workspace.name.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="flex-1 truncate font-medium">
                {selectedWorkspace.workspace.name}
              </span>
            </>
          ) : (
            <>
              <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted">
                <Plus className="size-3 text-muted-foreground" />
              </div>
              <span className="flex-1 text-muted-foreground">Select organization</span>
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
                className="flex items-center gap-2"
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
                  <span className="truncate text-sm font-medium">{workspace.name}</span>
                  <span className="text-xs text-muted-foreground capitalize">{role}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Badge
                    variant={statusVariant[workspace.connectionStatus]}
                    className={cn(
                      workspace.connectionStatus === "active" && "bg-green-500/15 text-green-600 dark:text-green-400"
                    )}
                  >
                    {workspace.connectionStatus}
                  </Badge>
                  {workspace.id === selectedWorkspaceId && (
                    <CheckIcon className="size-3.5 text-muted-foreground" />
                  )}
                </div>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
          </>
        )}
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
  )
}
