import { Outlet, createFileRoute, Navigate } from "@tanstack/react-router"
import { useState } from "react"
import { authClient } from "@/lib/auth-client"
import { AppSidebar } from "@/components/sidebar/app-sidebar"
import { WorkspaceContext } from "@/contexts/workspace-context"

export const Route = createFileRoute("/_app")({
  component: AppLayout,
})

function AppLayout() {
  const { data: session, isPending } = authClient.useSession()
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null)

  if (isPending) return null
  if (!session) return <Navigate to="/login" />

  return (
    <WorkspaceContext.Provider value={{ selectedWorkspaceId, setSelectedWorkspaceId }}>
      <div className="flex h-svh overflow-hidden bg-background text-foreground">
        <AppSidebar />
        <main className="flex flex-1 flex-col overflow-auto">
          <Outlet />
        </main>
      </div>
    </WorkspaceContext.Provider>
  )
}
