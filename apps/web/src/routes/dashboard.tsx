import { Navigate, createFileRoute } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { authClient } from "@/lib/auth-client"
import { useMeUser } from "@/hooks/use-me"

export const Route = createFileRoute("/dashboard")({ component: DashboardPage })

function DashboardPage() {
  const { data: session, isPending: sessionPending } = authClient.useSession()
  const { data: user, isPending: userPending } = useMeUser()

  if (sessionPending) return null
  if (!session) return <Navigate to="/login" />

  const displayName = user?.name ?? user?.email ?? session.user.email
  const initials = displayName.slice(0, 2).toUpperCase()

  return (
    <div className="min-h-svh bg-background text-foreground">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <h1 className="text-lg font-semibold">Dashboard</h1>
        <div className="flex items-center gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
            {initials}
          </div>
          <span className="hidden text-sm text-muted-foreground sm:inline">{displayName}</span>
          <Button variant="outline" size="sm" onClick={() => authClient.signOut()}>
            Sign out
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-lg p-6">
        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
            <CardDescription>Your signed-in profile.</CardDescription>
          </CardHeader>
          <CardContent>
            {userPending ? (
              <p className="text-sm text-muted-foreground">Loading account…</p>
            ) : user ? (
              <dl className="grid gap-3 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Name</dt>
                  <dd>{user.name}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Email</dt>
                  <dd>{user.email}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Email verified</dt>
                  <dd>{user.emailVerified ? "Yes" : "No"}</dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">Could not load account data.</p>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
