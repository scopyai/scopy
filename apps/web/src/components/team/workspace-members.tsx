import { useState } from "react"
import { toast } from "sonner"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar"
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
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"
import { useWorkspaceMembers } from "@/hooks/use-workspace-members"
import {
  useInviteWorkspaceMember,
  useUpdateWorkspaceMember,
  useRemoveWorkspaceMember,
} from "@/hooks/use-workspace-member-mutations"

type MemberRole = "owner" | "admin" | "member"
type MemberStatus = "active" | "pending"

const roleBadgeVariant: Record<
  MemberRole,
  "default" | "secondary" | "outline"
> = {
  owner: "default",
  admin: "secondary",
  member: "outline",
}

const statusBadgeVariant: Record<
  MemberStatus,
  "default" | "secondary" | "outline"
> = {
  active: "secondary",
  pending: "outline",
}

interface WorkspaceMembersProps {
  workspaceId: string
  currentUserId: string
  currentUserRole: MemberRole
}

export function WorkspaceMembers({
  workspaceId,
  currentUserId,
  currentUserRole,
}: WorkspaceMembersProps) {
  const { data: members, isPending: membersLoading } =
    useWorkspaceMembers(workspaceId)
  const invite = useInviteWorkspaceMember(workspaceId)
  const updateMember = useUpdateWorkspaceMember(workspaceId)
  const removeMember = useRemoveWorkspaceMember(workspaceId)

  const [inviteEmail, setInviteEmail] = useState("")
  const [inviteRole, setInviteRole] = useState<"admin" | "member">("member")
  const [removeTarget, setRemoveTarget] = useState<{
    id: string
    name: string
  } | null>(null)

  const canManage = currentUserRole === "owner" || currentUserRole === "admin"

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!inviteEmail.trim()) return

    try {
      await invite.mutateAsync({ email: inviteEmail.trim(), role: inviteRole })
      toast.success(`Invitation sent to ${inviteEmail.trim()}`)
      setInviteEmail("")
      setInviteRole("member")
    } catch {
      // errors are handled in the mutation hook
    }
  }

  const handleRoleChange = async (
    memberId: string,
    role: "admin" | "member"
  ) => {
    try {
      await updateMember.mutateAsync({ memberId, role })
      toast.success("Role updated")
    } catch {
      // errors handled in hook
    }
  }

  const handleRemoveConfirm = async () => {
    if (!removeTarget) return
    try {
      await removeMember.mutateAsync(removeTarget.id)
      toast.success(`Removed ${removeTarget.name}`)
    } catch {
      // errors handled in hook
    } finally {
      setRemoveTarget(null)
    }
  }

  const canChangeRole = (
    targetRole: MemberRole,
    targetUserId: string
  ): boolean => {
    if (targetUserId === currentUserId) return false
    if (targetRole === "owner") return false
    if (currentUserRole === "admin" && targetRole !== "member") return false
    return true
  }

  const canRemove = (targetRole: MemberRole, targetUserId: string): boolean => {
    if (targetUserId === currentUserId) return false
    if (targetRole === "owner") return false
    if (currentUserRole === "admin" && targetRole !== "member") return false
    return true
  }

  const memberCount = members?.length ?? 0
  const memberGridClass = canManage
    ? "grid grid-cols-[auto_minmax(0,1fr)_5.5rem_4.5rem_3.5rem] items-center gap-3"
    : "grid grid-cols-[auto_minmax(0,1fr)_5.5rem_4.5rem] items-center gap-3"
  const roleSelectClassName =
    "!h-6 w-full gap-1 py-0 pl-1.5 pr-1 text-xs shadow-none [&_svg]:size-3"

  return (
    <>
      <section className="flex flex-col gap-2">
        {canManage && (
          <form
            onSubmit={handleInvite}
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
          >
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="invite-email">Email address</Label>
              <Input
                id="invite-email"
                type="email"
                placeholder="colleague@example.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                disabled={invite.isPending}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="invite-role">Role</Label>
              <Select
                value={inviteRole}
                onValueChange={(v) => setInviteRole(v as "admin" | "member")}
                disabled={invite.isPending || currentUserRole === "admin"}
              >
                <SelectTrigger id="invite-role" className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="member">Member</SelectItem>
                  {currentUserRole === "owner" && (
                    <SelectItem value="admin">Admin</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
            <Button
              type="submit"
              className="min-w-24 shrink-0"
              disabled={!inviteEmail.trim() || invite.isPending}
            >
              {invite.isPending ? "Inviting…" : "Invite"}
            </Button>
          </form>
        )}

        {canManage && (
          <p className="text-xs text-muted-foreground">
            The user must already have an account with that email address.
          </p>
        )}

        <div className={cn("flex flex-col gap-2", canManage && "mt-4")}>
        {membersLoading ? (
          <div className="flex flex-col gap-2">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3"
              >
                <Skeleton className="size-8 rounded-full" />
                <div className="flex flex-1 flex-col gap-1.5">
                  <Skeleton className="h-3.5 w-32" />
                  <Skeleton className="h-3 w-48" />
                </div>
                <Skeleton className="h-5 w-14 rounded-full" />
              </div>
            ))}
          </div>
        ) : members && members.length > 0 ? (
          <div className="flex flex-col gap-2">
            <div
              className={`${memberGridClass} px-4 text-xs text-muted-foreground`}
            >
              <span className="col-span-2 flex h-6 items-center">
                {memberCount} {memberCount === 1 ? "member" : "members"}
              </span>
              <span className="flex h-6 items-center">Role</span>
              <span className="flex h-6 items-center">Status</span>
              {canManage && (
                <span className="flex h-6 items-center justify-end">
                  Actions
                </span>
              )}
            </div>
            {members.map((member) => {
              const memberRole = member.role as MemberRole
              const memberStatus = member.status as MemberStatus
              const showRoleSelect =
                canManage && canChangeRole(memberRole, member.user.id)
              const showRemove =
                canManage && canRemove(memberRole, member.user.id)

              return (
                <div
                  key={member.id}
                  className={`${memberGridClass} rounded-lg border border-border bg-card px-4 py-2.5`}
                >
                  <Avatar size="sm">
                    <AvatarImage
                      src={member.user.image ?? undefined}
                      alt={member.user.name}
                    />
                    <AvatarFallback>
                      {member.user.name.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-sm font-medium">
                      {member.user.name}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {member.user.email}
                    </span>
                  </div>
                  <div className="flex h-6 items-center">
                    {showRoleSelect ? (
                      <Select
                        value={memberRole}
                        onValueChange={(v) =>
                          handleRoleChange(member.id, v as "admin" | "member")
                        }
                        disabled={updateMember.isPending}
                      >
                        <SelectTrigger
                          size="sm"
                          className={roleSelectClassName}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="member">Member</SelectItem>
                          {currentUserRole === "owner" && (
                            <SelectItem value="admin">Admin</SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge
                        variant={roleBadgeVariant[memberRole]}
                        className="capitalize"
                      >
                        {memberRole}
                      </Badge>
                    )}
                  </div>
                  <div className="flex h-6 items-center">
                    <Badge
                      variant={statusBadgeVariant[memberStatus]}
                      className="capitalize"
                    >
                      {memberStatus}
                    </Badge>
                  </div>
                  {canManage && (
                    <div className="flex h-6 items-center justify-end">
                      {showRemove ? (
                        <Button
                          variant="outline"
                          size="xs"
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          disabled={removeMember.isPending}
                          onClick={() =>
                            setRemoveTarget({
                              id: member.id,
                              name: member.user.name,
                            })
                          }
                        >
                          Remove
                        </Button>
                      ) : (
                        <span className="inline-block w-[4.25rem]" aria-hidden />
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No members yet
          </p>
        )}
        </div>
      </section>

      <AlertDialog
        open={!!removeTarget}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removeTarget?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove their access to the workspace immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removeMember.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={removeMember.isPending}
              onClick={handleRemoveConfirm}
            >
              {removeMember.isPending ? "Removing…" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
