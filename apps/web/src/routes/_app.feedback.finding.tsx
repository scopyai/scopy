import { useState } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@workspace/ui/components/alert-dialog"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Textarea } from "@workspace/ui/components/textarea"
import { useSubmitFeedback } from "@/hooks/use-submit-feedback"

const severityClass: Record<string, string> = {
  critical: "bg-red-500/15 text-red-500",
  high: "bg-orange-500/15 text-orange-500",
  medium: "bg-amber-500/15 text-amber-600",
  low: "bg-muted text-muted-foreground",
}

const FEEDBACK_MESSAGE_MAX_LENGTH = 4000
const USER_NOTE_MAX_LENGTH = 1500
const TRUNCATION_SUFFIX = "\n\n[truncated]"

export const Route = createFileRoute("/_app/feedback/finding")({
  validateSearch: (search) => ({ data: String(search.data ?? "") }),
  component: FindingFeedback,
})

type Finding = {
  repo: string
  file: string
  severity: string
  title: string
  comment: string
}

function decode(data: string): Finding | null {
  try {
    const b64 = data.replace(/-/g, "+").replace(/_/g, "/")
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return null
  }
}

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) return value
  if (maxLength <= TRUNCATION_SUFFIX.length) {
    return value.slice(0, maxLength)
  }
  return `${value.slice(0, maxLength - TRUNCATION_SUFFIX.length)}${TRUNCATION_SUFFIX}`
}

function buildFeedbackMessage(finding: Finding, note: string) {
  const normalizedNote = truncate(note.trim(), USER_NOTE_MAX_LENGTH)
  const prefix = [
    `Finding feedback – ${finding.repo}`,
    `${finding.file} [${finding.severity}]`,
    finding.title,
    "",
    "Agent comment:",
  ].join("\n")
  const suffix = ["", "User note:", normalizedNote].join("\n")
  const reservedLength = prefix.length + suffix.length + 2
  const commentMaxLength = Math.max(
    0,
    FEEDBACK_MESSAGE_MAX_LENGTH - reservedLength
  )
  const message = [
    prefix,
    truncate(finding.comment, commentMaxLength),
    suffix,
  ].join("\n")

  return truncate(message, FEEDBACK_MESSAGE_MAX_LENGTH)
}

function FindingFeedback() {
  const { data } = Route.useSearch()
  const navigate = useNavigate()
  const [note, setNote] = useState("")
  const { mutate, isPending } = useSubmitFeedback()

  const finding = decode(data)

  function close() {
    navigate({ to: "/" })
  }

  function send() {
    if (!finding || !note.trim()) return
    mutate(buildFeedbackMessage(finding, note), { onSuccess: close })
  }

  return (
    <AlertDialog open onOpenChange={(open) => !open && close()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Send feedback on this finding</AlertDialogTitle>
          <AlertDialogDescription>
            This is exactly what our team will receive, along with your note.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {finding ? (
          <div className="space-y-4 text-left text-sm">
            <div className="overflow-hidden rounded-lg border">
              <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
                <span className="truncate text-xs text-muted-foreground">
                  {finding.repo}
                </span>
                <Badge
                  className={severityClass[finding.severity] ?? severityClass.low}
                >
                  {finding.severity}
                </Badge>
              </div>
              <div className="space-y-2 p-3">
                <code className="block break-all rounded bg-muted px-1.5 py-1 text-xs">
                  {finding.file}
                </code>
                <p className="font-medium text-foreground">{finding.title}</p>
                <p className="max-h-40 overflow-y-auto whitespace-pre-wrap text-muted-foreground">
                  {finding.comment}
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="finding-feedback-note"
                className="text-xs font-medium text-muted-foreground"
              >
                Your feedback
              </label>
              <Textarea
                id="finding-feedback-note"
                autoFocus
                rows={3}
                className="max-h-48 resize-none overflow-y-auto"
                placeholder="What's wrong or right about this finding?"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={USER_NOTE_MAX_LENGTH}
                disabled={isPending}
              />
              <p className="text-right text-xs text-muted-foreground">
                {note.length}/{USER_NOTE_MAX_LENGTH}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            This feedback link is invalid.
          </p>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <Button
            onClick={send}
            disabled={isPending || !finding || !note.trim()}
          >
            {isPending ? "Sending…" : "Send feedback"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
