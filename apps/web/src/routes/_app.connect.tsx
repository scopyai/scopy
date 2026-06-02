import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useEffect } from "react"
import { toast } from "sonner"
import { z } from "zod"
import { ConnectGitHub } from "@/components/connect-github"
import { getGitHubConnectionErrorMessage } from "@/lib/github-connection-errors"

const searchSchema = z.object({
  githubError: z.string().optional(),
})

export const Route = createFileRoute("/_app/connect")({
  validateSearch: searchSchema,
  component: ConnectPage,
})

function ConnectPage() {
  const { githubError } = Route.useSearch()
  const navigate = useNavigate()

  useEffect(() => {
    if (!githubError) return

    toast.error(getGitHubConnectionErrorMessage(githubError))
    navigate({ to: "/connect", search: {}, replace: true })
  }, [githubError, navigate])

  return (
    <div className="flex h-full items-center justify-center">
      <ConnectGitHub />
    </div>
  )
}
