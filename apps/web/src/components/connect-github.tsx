import { Button } from "@workspace/ui/components/button"
import { useInstallUrl } from "@/hooks/use-install-url"
import { toast } from "sonner"

type ConnectGitHubProps = {
  source?: "connect" | "onboarding"
  stepLabel?: string
  title?: string
  description?: string
}

const defaultTitle = "Connect GitHub"
const defaultDescription =
  "Install the GitHub App on your organization or personal account to start reviewing pull requests."

export function ConnectGitHub({
  source = "connect",
  stepLabel,
  title = defaultTitle,
  description = defaultDescription,
}: ConnectGitHubProps) {
  const { refetch, isFetching } = useInstallUrl(source)

  const handleConnect = async () => {
    const result = await refetch()
    if (result.error || !result.data?.url) {
      toast.error(
        "Failed to get GitHub install URL. Is the GitHub App configured?"
      )
      return
    }
    window.location.href = result.data.url
  }

  return (
    <div className="relative flex max-w-lg flex-col items-center gap-6 px-8 py-10 text-center">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 rounded-3xl bg-primary/5 blur-2xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute top-8 left-1/2 -z-10 size-40 -translate-x-1/2 rounded-full bg-primary/20 blur-3xl"
      />
      <div className="flex size-16 items-center justify-center rounded-2xl border border-primary/20 bg-muted shadow-[0_0_24px_-4px] shadow-primary/25">
        <svg
          viewBox="0 0 24 24"
          className="size-8 fill-foreground"
          aria-hidden="true"
        >
          <path d="M12 0C5.37 0 0 5.373 0 12c0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 21.795 24 17.298 24 12c0-6.627-5.373-12-12-12" />
        </svg>
      </div>
      <div className="flex flex-col gap-2">
        {stepLabel ? (
          <p className="text-sm font-medium text-muted-foreground">
            {stepLabel}
          </p>
        ) : null}
        <h1
          className={
            stepLabel
              ? "text-2xl font-semibold tracking-tight"
              : "text-lg font-semibold"
          }
        >
          {title}
        </h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <Button onClick={handleConnect} disabled={isFetching}>
        {isFetching ? "Loading…" : "Connect GitHub"}
      </Button>
    </div>
  )
}
