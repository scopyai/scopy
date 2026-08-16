import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Skeleton } from "@workspace/ui/components/skeleton"
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
import { LoadError } from "@/components/load-error"
import {
  getOnboardingWorkspaceId,
  markOnboardingOverviewSeen,
  setOnboardingWorkspaceId,
} from "@/lib/onboarding-flow"
import { findPreferredActiveWorkspace } from "@/lib/workspace-slug"

const searchSchema = z.object({
  connected: z.union([z.literal("1"), z.literal(1)]).optional(),
  workspaceId: z.string().optional(),
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
      "Choose which repos Scopy should watch. You can update this anytime from repository settings.",
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
  const { connected, workspaceId } = Route.useSearch()
  const navigate = useNavigate()
  const { data: workspaces, isPending, isError, refetch } = useWorkspaces()
  const activeWorkspace = findPreferredActiveWorkspace(
    workspaces,
    workspaceId ?? getOnboardingWorkspaceId()
  )?.workspace

  useEffect(() => {
    if (!connected) return

    if (workspaceId) setOnboardingWorkspaceId(workspaceId)
    toast.success("GitHub connected successfully")
    navigate({ to: "/onboarding/overview", search: {}, replace: true })
  }, [connected, navigate, workspaceId])

  if (isPending) return <OnboardingOverviewSkeleton />
  if (isError) {
    return (
      <LoadError
        message="Failed to load organizations"
        onRetry={() => void refetch()}
      />
    )
  }
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
            Step 2 of 4
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
              Scopy runs in the background and keeps feedback where your team
              already works – on the pull request.
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

function OnboardingOverviewSkeleton() {
  return (
    <div className="flex h-full items-center justify-center px-6 py-10">
      <div className="flex w-full max-w-2xl flex-col gap-6">
        <div className="flex flex-col items-center gap-3">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-full max-w-md" />
        </div>
        <Skeleton className="h-[360px] w-full rounded-xl" />
        <div className="flex justify-end">
          <Skeleton className="h-9 w-44" />
        </div>
      </div>
    </div>
  )
}
