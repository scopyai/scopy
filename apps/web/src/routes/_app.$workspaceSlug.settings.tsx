import { createFileRoute } from "@tanstack/react-router"
import {
  ExternalLinkIcon,
  RefreshCwIcon,
  Settings2Icon,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@workspace/ui/components/button"
import { PageHeader } from "@/components/page-header"
import { WorkspaceReviewSettings } from "@/components/repositories/workspace-review-settings"
import { ByokSettings } from "@/components/billing/byok-settings"
import { useWorkspaceContext } from "@/contexts/workspace-context"
import { useWorkspaces } from "@/hooks/use-workspaces"
import { useInstallUrl } from "@/hooks/use-install-url"
import { useWorkspaceGithubLinks } from "@/hooks/use-workspace-github-links"

export const Route = createFileRoute("/_app/$workspaceSlug/settings")({
  component: SettingsRoute,
})

function SettingsRoute() {
  const { selectedWorkspaceId } = useWorkspaceContext()
  const { data: workspaces } = useWorkspaces()
  const { refetch: fetchInstallUrl, isFetching: fetchingUrl } = useInstallUrl()
  const { data: githubLinks } = useWorkspaceGithubLinks(selectedWorkspaceId)

  const selectedEntry = workspaces?.find(
    (entry) => entry.workspace.id === selectedWorkspaceId
  )
  const canEdit =
    selectedEntry?.role === "owner" || selectedEntry?.role === "admin"

  const isReinstall =
    githubLinks?.action === "reinstall" ||
    selectedEntry?.workspace.connectionStatus === "deleted"

  const handleConfigureGitHub = async () => {
    if (isReinstall) {
      const result = await fetchInstallUrl()
      if (result.error || !result.data?.url) {
        toast.error(
          "Failed to get GitHub install URL. Is the GitHub App configured?"
        )
        return
      }
      window.location.href = result.data.url
    } else if (githubLinks?.installationSettingsUrl) {
      window.open(
        githubLinks.installationSettingsUrl,
        "_blank",
        "noopener,noreferrer"
      )
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader icon={Settings2Icon} title="Settings" />

      {selectedWorkspaceId ? (
        <div className="flex-1 overflow-auto p-6">
          <div className="flex flex-col gap-6">
            <WorkspaceReviewSettings
              workspaceId={selectedWorkspaceId}
              canEdit={canEdit}
            />

            <ByokSettings
              workspaceId={selectedWorkspaceId}
              canEdit={canEdit}
            />

            <section className="flex flex-col gap-3 border-t border-border pt-5">
              <p className="text-sm text-muted-foreground">GitHub</p>
              <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
                <Settings2Icon className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">GitHub configuration</p>
                  <p className="text-xs text-muted-foreground">
                    {isReinstall
                      ? "The GitHub App installation needs to be reinstalled."
                      : "Manage repository access and permissions on GitHub."}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={handleConfigureGitHub}
                  disabled={
                    fetchingUrl ||
                    (!isReinstall && !githubLinks?.installationSettingsUrl)
                  }
                >
                  {isReinstall ? (
                    <>
                      <RefreshCwIcon className="size-3.5" />
                      {fetchingUrl ? "Loading…" : "Reinstall on GitHub"}
                    </>
                  ) : (
                    <>
                      <ExternalLinkIcon className="size-3.5" />
                      Configure on GitHub
                    </>
                  )}
                </Button>
              </div>
            </section>
          </div>
        </div>
      ) : null}
    </div>
  )
}
