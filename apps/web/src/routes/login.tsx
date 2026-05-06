import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router"
import { useMutation } from "@tanstack/react-query"
import { useState } from "react"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@workspace/ui/components/card"
import { authClient } from "@/lib/auth-client"

export const Route = createFileRoute("/login")({ component: LoginPage })

type AuthMode = "sign-in" | "sign-up"

function LoginPage() {
  const navigate = useNavigate()
  const { data: session, isPending } = authClient.useSession()
  const [mode, setMode] = useState<AuthMode>("sign-in")
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")

  const mutation = useMutation({
    mutationFn: async () => {
      const result =
        mode === "sign-in"
          ? await authClient.signIn.email({
              email,
              password,
              callbackURL: "/chat",
            })
          : await authClient.signUp.email({
              name,
              email,
              password,
              callbackURL: "/chat",
            })

      const { error } = result
      if (error) {
        throw new Error(error.message ?? "Authentication failed")
      }

      if (mode === "sign-in") {
        return
      }

      const signInResult = await authClient.signIn.email({
        email,
        password,
        callbackURL: "/chat",
      })

      if (signInResult.error) {
        throw new Error(signInResult.error.message ?? "Account created, but sign in failed")
      }
    },
    onSuccess: () => navigate({ to: "/chat" }),
  })

  if (isPending) return null

  if (session) return <Navigate to="/chat" />

  return (
    <div className="flex min-h-svh items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{mode === "sign-in" ? "Sign in" : "Create account"}</CardTitle>
          <CardDescription>
            {mode === "sign-in"
              ? "Use your email and password to continue."
              : "Create a new account with your email and password."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              mutation.mutate()
            }}
            className="flex flex-col gap-4"
          >
            {mode === "sign-up" && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  type="text"
                  placeholder="Jane Doe"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoComplete="name"
                  autoFocus
                />
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                autoFocus={mode === "sign-in"}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="At least 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
              />
            </div>
            {mutation.error && (
              <p className="text-sm text-destructive">
                {(mutation.error as Error).message}
              </p>
            )}
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending
                ? "Please wait..."
                : mode === "sign-in"
                  ? "Sign in"
                  : "Create account"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                mutation.reset()
                setMode(mode === "sign-in" ? "sign-up" : "sign-in")
              }}
            >
              {mode === "sign-in"
                ? "Need an account? Sign up"
                : "Already have an account? Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
