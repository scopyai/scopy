import { useState } from "react"
import type { ChangeEvent, KeyboardEvent } from "react"
import { ArrowUpIcon, MessageSquareIcon } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Textarea } from "@workspace/ui/components/textarea"
import { cn } from "@workspace/ui/lib/utils"
import { useSubmitFeedback } from "@/hooks/use-submit-feedback"

export function SidebarFeedback({ onExpand }: { onExpand: () => void }) {
  const [message, setMessage] = useState("")
  const { mutate, isPending } = useSubmitFeedback()

  function handleSubmit() {
    const trimmed = message.trim()
    if (!trimmed) return

    mutate(trimmed, {
      onSuccess: () => {
        setMessage("")
      },
    })
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="sidebar-collapsed-only mx-auto hidden"
        title="Feedback"
        aria-label="Open feedback form"
        onClick={onExpand}
      >
        <MessageSquareIcon />
      </Button>
      <div className="sidebar-expanded-only rounded-xl bg-muted/50 p-2 shadow-md ring-1 ring-border/30">
        <Textarea
          placeholder="For feedback or anything else..."
          aria-label="Feedback message"
          rows={1}
          value={message}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
            setMessage(event.target.value)
          }
          onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              handleSubmit()
            }
          }}
          disabled={isPending}
          className="max-h-32 min-h-8 resize-none overflow-y-auto border-0 bg-transparent px-1 py-1 shadow-none focus-visible:border-transparent focus-visible:ring-0 dark:bg-transparent"
        />
        <div className="flex items-center justify-end pt-1">
          <Button
            type="button"
            size="icon-xs"
            variant="default"
            aria-label={isPending ? "Sending feedback" : "Send feedback"}
            onClick={handleSubmit}
            disabled={isPending || !message.trim()}
          >
            <ArrowUpIcon
              className={cn(isPending && "animate-pulse")}
              data-icon="inline-start"
            />
          </Button>
        </div>
      </div>
    </>
  )
}
