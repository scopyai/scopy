import { createFileRoute, Link } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"

export const Route = createFileRoute("/")({ component: LandingPage })

function LandingPage() {
  return (
    <div className="flex min-h-svh items-center justify-center bg-background">
      <Button asChild size="lg">
        <Link to="/login">Get started</Link>
      </Button>
    </div>
  )
}
