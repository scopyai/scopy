import {
  BrainIcon,
  CirclePauseIcon,
  CirclePlayIcon,
  ExternalLinkIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react"
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
import { Separator } from "@workspace/ui/components/separator"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { Textarea } from "@workspace/ui/components/textarea"
import { cn } from "@workspace/ui/lib/utils"
import {
  useDeleteMemory,
  useUpdateMemory,
  useWorkspaceMemories,
} from "@/hooks/use-memories"
import type { WorkspaceMemory } from "@/hooks/use-memories"

interface MemoryListProps {
  workspaceId: string
  repositoryId?: string
  canEdit: boolean
  showRepository?: boolean
}

export function MemoryList({
  workspaceId,
  repositoryId,
  canEdit,
  showRepository = true,
}: MemoryListProps) {
  const { data: memories, isLoading } = useWorkspaceMemories(
    workspaceId,
    repositoryId
  )

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }

  if (!memories?.length) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border py-10 text-center">
        <BrainIcon className="size-5 text-muted-foreground" />
        <p className="text-sm font-medium">No memories yet</p>
        <p className="max-w-sm px-4 text-xs text-muted-foreground">
          Reply to a review finding and explain what the reviewer should learn.
          Memories will appear here.
        </p>
      </div>
    )
  }

  const enabledMemories = memories.filter((memory) => memory.enabled)
  const disabledMemories = memories.filter((memory) => !memory.enabled)

  const renderMemory = (memory: WorkspaceMemory) => (
    <MemoryRow
      key={memory.id}
      memory={memory}
      workspaceId={workspaceId}
      canEdit={canEdit}
      showRepository={showRepository}
    />
  )

  return (
    <div className="flex flex-col gap-2">
      {enabledMemories.map(renderMemory)}

      {enabledMemories.length > 0 && disabledMemories.length > 0 ? (
        <div className="py-1">
          <Separator />
          <p className="mt-3 mb-1 text-sm text-muted-foreground">Disabled</p>
        </div>
      ) : null}

      {disabledMemories.map(renderMemory)}
    </div>
  )
}

function MemoryRow({
  memory,
  workspaceId,
  canEdit,
  showRepository,
}: {
  memory: WorkspaceMemory
  workspaceId: string
  canEdit: boolean
  showRepository: boolean
}) {
  const updateMemory = useUpdateMemory(workspaceId)
  const deleteMemory = useDeleteMemory(workspaceId)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [draft, setDraft] = useState(memory.content)

  const handleToggle = () => {
    updateMemory.mutate(
      { memoryId: memory.id, enabled: !memory.enabled },
      {
        onSuccess: () =>
          toast.success(memory.enabled ? "Memory disabled" : "Memory enabled"),
        onError: () => toast.error("Failed to update memory"),
      }
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
    <article
      className={cn(
        "rounded-lg border border-border bg-card p-4 transition-colors",
        !memory.enabled && "border-dashed"
      )}
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {showRepository ? (
            <Badge variant="outline">{memory.repository.fullName}</Badge>
          ) : null}
          {memory.pathGlob ? (
            <Badge variant="outline">{memory.pathGlob}</Badge>
          ) : null}
          {memory.sourceCommentUrl ? (
            <a
              href={memory.sourceCommentUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              Source comment <ExternalLinkIcon className="size-3" />
            </a>
          ) : null}
          <span className="text-xs text-muted-foreground">
            {new Date(memory.createdAt).toLocaleDateString()}
          </span>
        </div>

        <p
          className={cn(
            "text-sm leading-relaxed",
            !memory.enabled && "text-muted-foreground"
          )}
        >
          {memory.content}
        </p>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleToggle}
            disabled={!canEdit || updateMemory.isPending}
          >
            {memory.enabled ? (
              <CirclePauseIcon className="size-3.5" />
            ) : (
              <CirclePlayIcon className="size-3.5" />
            )}
            {memory.enabled ? "Disable" : "Enable"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setDraft(memory.content)
              setEditOpen(true)
            }}
            disabled={!canEdit}
          >
            <PencilIcon className="size-3.5" />
            Edit
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => setDeleteOpen(true)}
            disabled={!canEdit || deleteMemory.isPending}
          >
            <Trash2Icon className="size-3.5" />
            Delete
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
    </article>
  )
}
