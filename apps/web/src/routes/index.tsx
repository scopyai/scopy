import { Link, Navigate, createFileRoute } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import { authClient } from "@/lib/auth-client"

export const Route = createFileRoute("/")({ component: LandingPage })

function LandingPage() {
  const { data: session, isPending } = authClient.useSession()

  if (isPending) return null
  if (session) return <Navigate to="/dashboard" />

  return (
    <div className="flex min-h-svh items-center justify-center bg-background">
      <Button asChild size="lg">
        <Link to="/login">Get started</Link>
      </Button>
    </div>
  )
}
