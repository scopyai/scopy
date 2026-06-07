import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useEffect } from "react"
import { toast } from "sonner"
import { z } from "zod"
import { ConnectGitHub } from "@/components/connect-github"
import { getGitHubConnectionErrorMessage } from "@/lib/github-connection-errors"

const searchSchema = z.object({
  githubError: z.string().optional(),
})

export const Route = createFileRoute("/_app/onboarding/connect")({
  validateSearch: searchSchema,
  component: OnboardingConnectPage,
})

function OnboardingConnectPage() {
  const { githubError } = Route.useSearch()
  const navigate = useNavigate()

  useEffect(() => {
    if (!githubError) return

    toast.error(getGitHubConnectionErrorMessage(githubError))
    navigate({ to: "/onboarding/connect", search: {}, replace: true })
  }, [githubError, navigate])

  return (
    <div className="flex h-full items-center justify-center px-6">
      <ConnectGitHub
        source="onboarding"
        stepLabel="Step 1 of 3"
        title="Connect your GitHub repositories"
        description="Review starts after the GitHub App is installed on your account or organization. You will choose which repositories to enable next."
      />
    </div>
  )
}
