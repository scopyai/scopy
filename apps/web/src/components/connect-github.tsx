import { Button } from "@workspace/ui/components/button"
import { useInstallUrl } from "@/hooks/use-install-url"
import { toast } from "sonner"

export function ConnectGitHub() {
  const { refetch, isFetching } = useInstallUrl()

  const handleConnect = async () => {
    const result = await refetch()
    if (result.error || !result.data?.url) {
      toast.error("Failed to get GitHub install URL. Is the GitHub App configured?")
      return
    }
    window.location.href = result.data.url
  }

  return (
    <div className="flex flex-col items-center justify-center gap-6 py-20 text-center">
      <div className="flex size-16 items-center justify-center rounded-2xl border border-border bg-muted">
        <svg
          viewBox="0 0 24 24"
          className="size-8 fill-foreground"
          aria-hidden="true"
        >
          <path d="M12 0C5.37 0 0 5.373 0 12c0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 21.795 24 17.298 24 12c0-6.627-5.373-12-12-12" />
        </svg>
      </div>
      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Connect GitHub</h2>
        <p className="max-w-sm text-sm text-muted-foreground">
          Install the GitHub App on your organization or personal account to start
          reviewing pull requests.
        </p>
      </div>
      <Button onClick={handleConnect} disabled={isFetching}>
        {isFetching ? "Loading…" : "Connect GitHub"}
      </Button>
    </div>
  )
}
