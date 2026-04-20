import { createFileRoute, Navigate } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { authClient } from "@/lib/auth-client"
import { useMeUser } from "@/hooks/use-me"

export const Route = createFileRoute("/chat")({ component: ChatPage })

const PLACEHOLDER_CONVERSATIONS = [
  "Quantum computing overview",
  "Climate change models",
  "History of the Roman Empire",
]

function ChatPage() {
  const { data: session, isPending } = authClient.useSession()
  const { data: user } = useMeUser()

  if (isPending) return null

  if (!session) return <Navigate to="/login" />

  const displayName = user?.name ?? user?.email ?? session.user.email ?? "User"
  const initials = displayName.slice(0, 2).toUpperCase()

  return (
    <div className="flex h-svh bg-background text-foreground">
      {/* Sidebar */}
      <aside className="flex w-52 shrink-0 flex-col border-r border-border">
        <div className="flex-1 overflow-y-auto p-3">
          <nav className="flex flex-col gap-0.5">
            {PLACEHOLDER_CONVERSATIONS.map((title) => (
              <button
                key={title}
                className="truncate rounded-md px-2.5 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {title}
              </button>
            ))}
          </nav>
        </div>

        {/* User footer */}
        <div className="flex items-center gap-2.5 border-t border-border p-3">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-medium text-primary-foreground">
            {initials}
          </div>
          <span className="truncate text-sm text-muted-foreground">{displayName}</span>
          <Button
            variant="ghost"
            size="icon-sm"
            className="ml-auto shrink-0"
            onClick={() => authClient.signOut()}
            title="Sign out"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-3.5"
            >
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </Button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex flex-1 flex-col overflow-hidden">
        {/* Message area */}
        <div className="flex-1 overflow-y-auto" />

        {/* Input bar */}
        <div className="border-t border-border p-4">
          <div className="mx-auto max-w-2xl">
            <Input
              placeholder="Ask anything…"
              className="rounded-xl bg-muted/40 py-5 text-sm"
            />
          </div>
        </div>
      </main>
    </div>
  )
}
