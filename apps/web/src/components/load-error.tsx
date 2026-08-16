import { Button } from "@workspace/ui/components/button"

export function LoadError({
  message,
  onRetry,
  fullScreen = false,
}: {
  message: string
  onRetry: () => void
  fullScreen?: boolean
}) {
  return (
    <div
      className={
        fullScreen
          ? "flex h-svh items-center justify-center p-4"
          : "flex h-full min-h-40 items-center justify-center p-4"
      }
    >
      <div className="flex flex-col items-center gap-3 text-center">
        <p className="text-sm text-muted-foreground">{message}</p>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </div>
    </div>
  )
}
