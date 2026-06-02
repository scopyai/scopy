import { Separator } from "@workspace/ui/components/separator"
import { WorkspaceSwitcher } from "./workspace-switcher"
import { SidebarNav } from "./sidebar-nav"
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
    <aside className="flex h-svh w-[260px] shrink-0 flex-col border-r border-border bg-background text-sm">
      <div className="flex h-14 shrink-0 items-center border-b border-border px-2">
        <WorkspaceSwitcher />
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <SidebarNav />
      </div>

      <Separator />
      <div className="p-2">
        <UserMenu />
      </div>
    </aside>
  )
}
