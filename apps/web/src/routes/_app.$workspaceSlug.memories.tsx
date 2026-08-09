import { createFileRoute } from "@tanstack/react-router"
import { BrainIcon } from "lucide-react"
import { MemoryList } from "@/components/memories/memory-list"
import { PageHeader } from "@/components/page-header"
import { useWorkspaceContext } from "@/contexts/workspace-context"
import { useWorkspaces } from "@/hooks/use-workspaces"

export const Route = createFileRoute("/_app/$workspaceSlug/memories")({
  component: MemoriesRoute,
})

function MemoriesRoute() {
  const { selectedWorkspaceId } = useWorkspaceContext()
  const { data: workspaces } = useWorkspaces()
  const selectedEntry = workspaces?.find(
    (entry) => entry.workspace.id === selectedWorkspaceId
  )
  const canEdit =
    selectedEntry?.role === "owner" || selectedEntry?.role === "admin"

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader icon={BrainIcon} title="Memories" />

      <div className="flex-1 overflow-auto p-4 sm:p-6">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Memories learned from review conversations across this workspace.
            Each memory applies only to the repository shown.
          </p>

          {!canEdit && selectedEntry ? (
            <div className="rounded-lg border border-border bg-card px-4 py-3 text-xs text-muted-foreground">
              Only workspace admins can change review memories.
            </div>
          ) : null}

          {selectedWorkspaceId ? (
            <MemoryList workspaceId={selectedWorkspaceId} canEdit={canEdit} />
          ) : null}
        </div>
      </div>
    </div>
  )
}
