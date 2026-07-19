import { createFileRoute } from "@tanstack/react-router"
import { BrainIcon, ExternalLinkIcon, Trash2Icon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { Switch } from "@workspace/ui/components/switch"
import { Textarea } from "@workspace/ui/components/textarea"
import { PageHeader } from "@/components/page-header"
import { useWorkspaceContext } from "@/contexts/workspace-context"
import {
  useDeleteMemory,
  useUpdateMemory,
  useWorkspaceMemories,
  type WorkspaceMemory,
} from "@/hooks/use-memories"

export const Route = createFileRoute("/_app/$workspaceSlug/memories")({
  component: MemoriesRoute,
})

function MemoriesRoute() {
  const { selectedWorkspaceId } = useWorkspaceContext()
  const { data: memories, isLoading } = useWorkspaceMemories(
    selectedWorkspaceId
  )

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader icon={BrainIcon} title="Memories" />

      <div className="flex-1 overflow-auto p-4 sm:p-6">
        <p className="mb-4 text-sm text-muted-foreground">
          Guidance the reviewer has learned from your replies to its findings.
          Enabled memories will shape future reviews; edit or remove anything
          you do not want it to apply.
        </p>

        {isLoading || !selectedWorkspaceId ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : !memories?.length ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-12 text-center">
            <BrainIcon className="size-6 text-muted-foreground" />
            <p className="text-sm font-medium">No memories yet</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              Reply to a review finding on a pull request, for example
              explaining why it should not be flagged, and the reviewer will
              remember it here.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {memories.map((memory) => (
              <MemoryCard
                key={memory.id}
                memory={memory}
                workspaceId={selectedWorkspaceId}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function MemoryCard({
  memory,
  workspaceId,
}: {
  memory: WorkspaceMemory
  workspaceId: string
}) {
  const updateMemory = useUpdateMemory(workspaceId)
  const deleteMemory = useDeleteMemory(workspaceId)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [draft, setDraft] = useState(memory.content)

  const handleToggle = (enabled: boolean) => {
    updateMemory.mutate(
      { memoryId: memory.id, enabled },
      { onError: () => toast.error("Failed to update memory") }
    )
  }

  const handleSave = () => {
    updateMemory.mutate(
      { memoryId: memory.id, content: draft.trim() },
      {
        onSuccess: () => {
          setEditOpen(false)
          toast.success("Memory updated")
        },
        onError: () => toast.error("Failed to update memory"),
      }
    )
  }

  const handleDelete = () => {
    deleteMemory.mutate(memory.id, {
      onSuccess: () => toast.success("Memory deleted"),
      onError: () => toast.error("Failed to delete memory"),
    })
    setDeleteOpen(false)
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <p
        className={
          memory.enabled ? "text-sm" : "text-sm text-muted-foreground"
        }
      >
        {memory.content}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {memory.repository && (
          <Badge variant="secondary">{memory.repository.fullName}</Badge>
        )}
        {memory.pathGlob && (
          <Badge variant="outline">{memory.pathGlob}</Badge>
        )}
        {memory.sourceCommentUrl && (
          <a
            href={memory.sourceCommentUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            Source comment <ExternalLinkIcon className="size-3" />
          </a>
        )}
        <span className="text-xs text-muted-foreground">
          {new Date(memory.createdAt).toLocaleDateString()}
        </span>

        <div className="ml-auto flex items-center gap-2">
          <Switch
            checked={memory.enabled}
            onCheckedChange={handleToggle}
            disabled={updateMemory.isPending}
            aria-label="Enable memory"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setDraft(memory.content)
              setEditOpen(true)
            }}
          >
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => setDeleteOpen(true)}
            disabled={deleteMemory.isPending}
          >
            <Trash2Icon className="size-4" />
          </Button>
        </div>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit memory</DialogTitle>
          </DialogHeader>
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={4}
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={updateMemory.isPending || !draft.trim()}
            >
              {updateMemory.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this memory?</AlertDialogTitle>
            <AlertDialogDescription>
              The reviewer will no longer apply it. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={handleDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
