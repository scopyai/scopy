import { Separator } from "@workspace/ui/components/separator"
import { WorkspaceSwitcher } from "./workspace-switcher"
import { RepoList } from "./repo-list"
import { UserMenu } from "./user-menu"
import { useWorkspaceContext } from "@/contexts/workspace-context"
import { useWorkspaces } from "@/hooks/use-workspaces"
import { useEffect } from "react"

export function AppSidebar() {
  const { selectedWorkspaceId, setSelectedWorkspaceId } = useWorkspaceContext()
  const { data: workspaces } = useWorkspaces()

  useEffect(() => {
    if (!selectedWorkspaceId && workspaces && workspaces.length > 0) {
      setSelectedWorkspaceId(workspaces[0].workspace.id)
    }
  }, [workspaces, selectedWorkspaceId, setSelectedWorkspaceId])

  return (
    <aside className="flex h-svh w-[240px] shrink-0 flex-col border-r border-border bg-background">
      <div className="p-2">
        <WorkspaceSwitcher />
      </div>

      <Separator />

      {selectedWorkspaceId ? (
        <RepoList workspaceId={selectedWorkspaceId} />
      ) : workspaces && workspaces.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center p-4 text-center">
          <p className="text-xs text-muted-foreground">No organizations connected</p>
        </div>
      ) : (
        <div className="flex flex-1 flex-col" />
      )}

      <Separator />

      <div className="p-2">
        <UserMenu />
      </div>
    </aside>
  )
}
