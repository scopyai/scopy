import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useEffect } from "react"
import { toast } from "sonner"
import { z } from "zod"
import { useWorkspaces } from "@/hooks/use-workspaces"
import { useWorkspaceContext } from "@/contexts/workspace-context"
import { ConnectGitHub } from "@/components/connect-github"

const searchSchema = z.object({
  workspaceId: z.string().optional(),
})

export const Route = createFileRoute("/_app/dashboard")({
  validateSearch: searchSchema,
  component: DashboardPage,
})

function DashboardPage() {
  const { workspaceId: callbackWorkspaceId } = Route.useSearch()
  const navigate = useNavigate()
  const { selectedWorkspaceId, setSelectedWorkspaceId } = useWorkspaceContext()
  const { data: workspaces, isPending } = useWorkspaces()

  useEffect(() => {
    if (callbackWorkspaceId) {
      setSelectedWorkspaceId(callbackWorkspaceId)
      toast.success("Organization connected successfully")
      navigate({ to: "/dashboard", search: {}, replace: true })
    }
  }, [callbackWorkspaceId, setSelectedWorkspaceId, navigate])

  if (isPending) return null

  const hasNoWorkspaces = workspaces && workspaces.length === 0

  if (hasNoWorkspaces) {
    return (
      <div className="flex h-full items-center justify-center">
        <ConnectGitHub />
      </div>
    )
  }

  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center">
        <p className="text-sm text-muted-foreground">
          {selectedWorkspaceId
            ? "Select a repository from the sidebar to get started."
            : "Select an organization from the sidebar."}
        </p>
      </div>
    </div>
  )
}
