import {
  Outlet,
  createFileRoute,
  Navigate,
  useRouterState,
} from "@tanstack/react-router"
import { useState } from "react"
import { authClient } from "@/lib/auth-client"
import { AppSidebar } from "@/components/sidebar/app-sidebar"
import { WorkspaceContext } from "@/contexts/workspace-context"
import { useMeUser } from "@/hooks/use-me"
import { getOnboardingRepositoriesEntryPath } from "@/lib/onboarding-flow"

export const Route = createFileRoute("/_app")({
  component: AppLayout,
})

function AppLayout() {
  const { data: session, isPending } = authClient.useSession()
  const { data: user, isPending: userPending } = useMeUser()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(
    null
  )

  if (isPending) return null
  if (!session) return <Navigate to="/login" />

  if (userPending) return null

  const isOnboardingPath = pathname.startsWith("/onboarding")

  if (!isOnboardingPath && user?.onboardingStatus === "connect_github") {
    return <Navigate to="/onboarding/connect" replace />
  }

  if (!isOnboardingPath && user?.onboardingStatus === "select_repositories") {
    return (
      <Navigate to={getOnboardingRepositoriesEntryPath()} replace />
    )
  }

  return (
    <WorkspaceContext.Provider
      value={{ selectedWorkspaceId, setSelectedWorkspaceId }}
    >
      <div className="flex h-svh overflow-hidden bg-background text-foreground">
        {!isOnboardingPath ? <AppSidebar /> : null}
        <main className="flex min-w-0 flex-1 flex-col overflow-auto">
          <Outlet />
        </main>
      </div>
    </WorkspaceContext.Provider>
  )
}
