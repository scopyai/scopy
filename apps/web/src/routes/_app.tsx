import {
  Outlet,
  createFileRoute,
  Navigate,
  useRouterState,
} from "@tanstack/react-router"
import { useState } from "react"
import { Button } from "@workspace/ui/components/button"
import { authClient } from "@/lib/auth-client"
import { AppSidebar, MobileHeader } from "@/components/sidebar/app-sidebar"
import { WorkspaceContext } from "@/contexts/workspace-context"
import { useMeUser } from "@/hooks/use-me"
import {
  getOnboardingConnectEntryPath,
  getOnboardingRepositoriesEntryPath,
} from "@/lib/onboarding-flow"

export const Route = createFileRoute("/_app")({
  component: AppLayout,
})

function AppLayout() {
  const { data: session, isPending } = authClient.useSession()
  const { data: user, isPending: userPending } = useMeUser()
  const location = useRouterState({
    select: (state) => state.location,
  })
  const pathname = location.pathname
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(
    null
  )
  if (isPending) return null
  if (!session) {
    return <Navigate to="/login" search={{ redirect: location.href }} replace />
  }

  if (userPending) return null

  const isOnboardingPath = pathname.startsWith("/onboarding")

  if (!isOnboardingPath && user?.onboardingStatus === "connect_github") {
    return <Navigate to={getOnboardingConnectEntryPath()} replace />
  }

  if (!isOnboardingPath && user?.onboardingStatus === "select_repositories") {
    return <Navigate to={getOnboardingRepositoriesEntryPath()} replace />
  }

  return (
    <WorkspaceContext.Provider
      value={{ selectedWorkspaceId, setSelectedWorkspaceId }}
    >
      <div className="flex h-svh overflow-hidden bg-background text-foreground">
        {!isOnboardingPath ? <AppSidebar /> : null}
        <main className="flex min-w-0 flex-1 flex-col overflow-auto">
          {isOnboardingPath ? (
            <div className="flex shrink-0 justify-end px-4 py-3">
              <Button
                type="button"
                variant="text"
                onClick={() => authClient.signOut()}
              >
                Sign out
              </Button>
            </div>
          ) : (
            <MobileHeader />
          )}
          <div className="min-h-0 flex-1 overflow-auto">
            <Outlet />
          </div>
        </main>
      </div>
    </WorkspaceContext.Provider>
  )
}
