import { WorkspaceSwitcher } from "./workspace-switcher"
import { SidebarNav } from "./sidebar-nav"
import { SidebarFeedback } from "./sidebar-feedback"
import { UserMenu } from "./user-menu"

export function AppSidebar() {
  return (
    <aside className="flex h-svh w-[260px] shrink-0 flex-col border-r border-border bg-background text-sm">
      <div className="flex h-14 shrink-0 items-center border-b border-border px-2">
        <WorkspaceSwitcher />
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <SidebarNav />
      </div>

      <div className="flex shrink-0 flex-col gap-2 p-2">
        <SidebarFeedback />
        <UserMenu />
      </div>
    </aside>
  )
}
