"use client"

import { Settings2Icon, LogOutIcon, ChevronsUpDown } from "lucide-react"
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@workspace/ui/components/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { authClient } from "@/lib/auth-client"
import { useMeUser } from "@/hooks/use-me"

export function UserMenu() {
  const { data: session, isPending: sessionPending } = authClient.useSession()
  const { data: user } = useMeUser()

  if (sessionPending) {
    return (
      <div className="flex items-center gap-2 p-2">
        <Skeleton className="size-7 rounded-full" />
        <Skeleton className="h-4 w-32" />
      </div>
    )
  }

  const displayName = user?.name ?? user?.email ?? session?.user.email ?? ""
  const initials = displayName.slice(0, 2).toUpperCase()
  const avatarUrl = user?.image ?? undefined

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex w-full items-center gap-2 rounded-md p-2 text-left text-sm transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
          <Avatar size="sm">
            <AvatarImage src={avatarUrl} alt={displayName} />
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <div className="flex flex-1 flex-col overflow-hidden">
            <span className="truncate text-sm leading-none font-medium">
              {user?.name ?? displayName}
            </span>
            {/* {user?.name && (
              <span className="truncate text-xs text-muted-foreground">
                {user.email}
              </span>
            )} */}
          </div>
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">
              {user?.name ?? displayName}
            </span>
            <span className="text-xs text-muted-foreground">{user?.email}</span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled className="gap-2">
          <Settings2Icon />
          Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          className="gap-2"
          onClick={() => authClient.signOut()}
        >
          <LogOutIcon />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
