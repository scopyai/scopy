import { Link, createFileRoute } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import { authClient } from "@/lib/auth-client"
import { WorkspaceHomeRedirect } from "@/components/workspace-home-redirect"

export const Route = createFileRoute("/")({ component: LandingPage })

function LandingPage() {
  const { data: session, isPending } = authClient.useSession()

  if (isPending) return null
  if (session) return <WorkspaceHomeRedirect />

  return (
    <div className="flex min-h-svh items-center justify-center bg-background">
      <Button asChild size="lg">
        <Link to="/login">Get started</Link>
      </Button>
    </div>
  )
}
