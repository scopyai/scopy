import { CheckIcon, XIcon, MailIcon } from "lucide-react"
import { useNavigate } from "@tanstack/react-router"
import { toast } from "sonner"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar"
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@workspace/ui/components/dropdown-menu"
import {
  useAcceptWorkspaceInvitation,
  useRejectWorkspaceInvitation,
} from "@/hooks/use-workspace-member-mutations"
import { getWorkspaceSlug } from "@/lib/workspace-slug"

type PendingWorkspace = {
  workspace: {
    id: string
    name: string
    providerAccountLogin: string
    providerAccountAvatarUrl: string | null
  }
}

interface PendingWorkspaceInvitationsProps {
  pending: PendingWorkspace[]
}

export function PendingWorkspaceInvitations({
  pending,
}: PendingWorkspaceInvitationsProps) {
  const navigate = useNavigate()
  const accept = useAcceptWorkspaceInvitation()
  const reject = useRejectWorkspaceInvitation()

  const handleAccept = async (ws: PendingWorkspace["workspace"]) => {
    try {
      await accept.mutateAsync(ws.id)
      toast.success(`Joined ${ws.name}`)
      navigate({
        to: "/$workspaceSlug/repositories",
        params: { workspaceSlug: getWorkspaceSlug(ws) },
      })
    } catch {
      // error handled in mutation
    }
  }

  const handleReject = async (ws: PendingWorkspace["workspace"]) => {
    try {
      await reject.mutateAsync(ws.id)
      toast.success(`Declined invitation to ${ws.name}`)
    } catch {
      // error handled in mutation
    }
  }

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="min-h-11 gap-2 md:min-h-0">
        <MailIcon className="size-4 text-muted-foreground" />
        <span className="flex-1">Invitations</span>
        <span className="mr-1 ml-auto flex size-5 items-center justify-center rounded-full bg-primary text-[11px] font-medium text-primary-foreground">
          {pending.length}
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent
        className="w-[min(88vw,288px)]"
        sideOffset={6}
        collisionPadding={12}
      >
        {pending.map(({ workspace }, i) => (
          <div key={workspace.id}>
            {i > 0 && <DropdownMenuSeparator />}
            <DropdownMenuItem
              onSelect={(e) => e.preventDefault()}
              className="flex min-h-12 items-center gap-3 py-2"
            >
              <Avatar size="sm">
                <AvatarImage
                  src={workspace.providerAccountAvatarUrl ?? undefined}
                  alt={workspace.name}
                />
                <AvatarFallback>
                  {workspace.name.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="flex-1 truncate text-sm font-medium">
                {workspace.name}
              </span>
              <div className="flex shrink-0 gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-9 md:size-7"
                  disabled={accept.isPending || reject.isPending}
                  onClick={(e) => {
                    e.stopPropagation()
                    handleAccept(workspace)
                  }}
                  title="Accept invitation"
                >
                  <CheckIcon className="size-3.5 text-green-600" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-9 md:size-7"
                  disabled={accept.isPending || reject.isPending}
                  onClick={(e) => {
                    e.stopPropagation()
                    handleReject(workspace)
                  }}
                  title="Decline invitation"
                >
                  <XIcon className="size-3.5 text-destructive" />
                </Button>
              </div>
            </DropdownMenuItem>
          </div>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
