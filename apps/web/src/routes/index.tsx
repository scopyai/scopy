import { createFileRoute, Navigate } from "@tanstack/react-router"
import { authClient } from "@/lib/auth-client"
import { WorkspaceHomeRedirect } from "@/components/workspace-home-redirect"

export const Route = createFileRoute("/")({ component: HomePage })

function HomePage() {
  const { data: session, isPending } = authClient.useSession()

  if (isPending) return null
  if (session) return <WorkspaceHomeRedirect />

  return <Navigate to="/login" replace />
}
