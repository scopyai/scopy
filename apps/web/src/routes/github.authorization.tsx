import { createFileRoute } from "@tanstack/react-router"
import { useEffect } from "react"
import { z } from "zod"
import { env } from "@/env"
import { githubConnectionErrorCodes } from "@/lib/github-connection-errors"

const searchSchema = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
  error_description: z.string().optional(),
})

export const Route = createFileRoute("/github/authorization")({
  validateSearch: searchSchema,
  component: GitHubAuthorizationPage,
})

function GitHubAuthorizationPage() {
  const search = Route.useSearch()

  useEffect(() => {
    if (search.error) {
      const url = new URL("/dashboard", env.VITE_WEB_BASE_URL)
      url.searchParams.set(
        "githubError",
        githubConnectionErrorCodes.authorization_denied
      )
      window.location.replace(url.toString())
      return
    }

    const url = new URL("/github/callback", env.VITE_API_BASE_URL)

    for (const [key, value] of Object.entries(search)) {
      if (value != null) {
        url.searchParams.set(key, value)
      }
    }

    window.location.replace(url.toString())
  }, [search])

  return (
    <div className="flex min-h-svh items-center justify-center bg-background px-4">
      <p className="text-sm text-muted-foreground">
        Authorizing GitHub connection...
      </p>
    </div>
  )
}
