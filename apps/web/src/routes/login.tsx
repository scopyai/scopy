import { createFileRoute, Navigate } from "@tanstack/react-router"
import { useMutation } from "@tanstack/react-query"
import { useState } from "react"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@workspace/ui/components/card"
import { authClient } from "@/lib/auth-client"

export const Route = createFileRoute("/login")({ component: LoginPage })

function LoginPage() {
  const { data: session, isPending } = authClient.useSession()
  const [email, setEmail] = useState("")
  const [sent, setSent] = useState(false)

  const mutation = useMutation({
    mutationFn: async (email: string) => {
      const { error } = await authClient.signIn.magicLink({
        email,
        callbackURL: `${window.location.origin}/chat`,
      })
      if (error) throw new Error(error.message ?? "Failed to send magic link")
    },
    onSuccess: () => setSent(true),
  })

  if (isPending) return null

  if (session) return <Navigate to="/chat" />

  return (
    <div className="flex min-h-svh items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>
            Enter your email and we&apos;ll send you a magic link.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sent ? (
            <p className="text-sm text-muted-foreground">
              Check your email — the link will appear in the API console during development.
            </p>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                mutation.mutate(email)
              }}
              className="flex flex-col gap-4"
            >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              {mutation.error && (
                <p className="text-sm text-destructive">
                  {(mutation.error as Error).message}
                </p>
              )}
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? "Sending…" : "Send magic link"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
