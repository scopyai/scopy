import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import {
  ArrowRightIcon,
  AtSignIcon,
  FolderGit2Icon,
  GitPullRequestIcon,
  MessageSquareTextIcon,
} from "lucide-react"
import { useEffect } from "react"
import { toast } from "sonner"
import { z } from "zod"
import { useWorkspaces } from "@/hooks/use-workspaces"
import { markOnboardingOverviewSeen } from "@/lib/onboarding-flow"
import { getActiveWorkspaces } from "@/lib/workspace-slug"

const searchSchema = z.object({
  connected: z.union([z.literal("1"), z.literal(1)]).optional(),
})

export const Route = createFileRoute("/_app/onboarding/overview")({
  validateSearch: searchSchema,
  component: OnboardingOverviewPage,
})

const howItWorksSteps = [
  {
    icon: FolderGit2Icon,
    title: "Enable the repositories you want",
    description:
      "Choose which repos Review should watch. You can update this anytime from repository settings.",
  },
  {
    icon: GitPullRequestIcon,
    title: "Reviews run on pull requests",
    description:
      "When a PR is opened or marked ready for review, we analyze the changes automatically on enabled repositories.",
  },
  {
    icon: MessageSquareTextIcon,
    title: "Findings appear on the PR",
    description:
      "Issues and suggestions are posted as inline comments on the pull request, directly on the relevant lines.",
  },
  {
    icon: AtSignIcon,
    title: "Trigger a review anytime",
    description:
      "Leave a comment mentioning the GitHub App on any pull request to request a fresh review on demand.",
  },
] as const

function OnboardingOverviewPage() {
  const { connected } = Route.useSearch()
  const navigate = useNavigate()
  const { data: workspaces, isPending } = useWorkspaces()
  const activeWorkspace = getActiveWorkspaces(workspaces).at(0)?.workspace

  useEffect(() => {
    if (!connected) return

    toast.success("GitHub connected successfully")
    navigate({ to: "/onboarding/overview", search: {}, replace: true })
  }, [connected, navigate])

  if (isPending) return null
  if (!activeWorkspace) return <Navigate to="/onboarding/connect" replace />

  const handleContinue = () => {
    markOnboardingOverviewSeen()
    navigate({ to: "/onboarding/repositories" })
  }

  return (
    <div className="flex h-full items-center justify-center px-6 py-10">
      <div className="relative flex w-full max-w-2xl flex-col gap-6">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 rounded-3xl bg-primary/5 blur-2xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute top-0 left-1/2 -z-10 size-48 -translate-x-1/2 rounded-full bg-primary/15 blur-3xl"
        />

        <div className="flex flex-col gap-2 text-center">
          <p className="text-sm font-medium text-muted-foreground">
            Step 2 of 3
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            How review works
          </h1>
          <p className="text-sm text-muted-foreground">
            GitHub is connected for{" "}
            <span className="font-medium text-foreground">
              {activeWorkspace.name}
            </span>
            . Here is what happens after you enable repositories.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>What to expect</CardTitle>
            <CardDescription>
              Review runs in the background and keeps feedback where your team
              already works — on the pull request.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {howItWorksSteps.map((step, index) => (
              <div key={step.title} className="flex gap-4">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-[0_0_16px_-4px] shadow-primary/40">
                  <step.icon className="size-4" strokeWidth={2.25} />
                </div>
                <div className="flex min-w-0 flex-col gap-1 pt-0.5">
                  <p className="text-sm font-medium">
                    {index + 1}. {step.title}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {step.description}
                  </p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button onClick={handleContinue}>
            Choose repositories
            <ArrowRightIcon data-icon="inline-end" />
          </Button>
        </div>
      </div>
    </div>
  )
}
