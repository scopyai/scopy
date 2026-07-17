import { toast } from "sonner"
import { Switch } from "@workspace/ui/components/switch"
import { SettingsSection } from "@/components/repositories/settings-section"
import { Favicon } from "@/components/repositories/favicon"
import { useDocsCatalog } from "@/hooks/use-docs-catalog"
import { useRepositories } from "@/hooks/use-repositories"
import { useUpdateRepository } from "@/hooks/use-update-repository"

export function RepositoryDocLibraries({
  workspaceId,
  repositoryId,
  canEdit,
}: {
  workspaceId: string
  repositoryId: string
  canEdit: boolean
}) {
  const { data: repositories } = useRepositories(workspaceId)
  const { data: catalog } = useDocsCatalog()
  const updateRepository = useUpdateRepository(workspaceId)

  const repo = repositories?.find((entry) => entry.id === repositoryId)
  if (!repo) return null

  const detected = repo.detectedDocLibraries ?? []
  const excluded = new Set(repo.excludedDocLibraries ?? [])

  const faviconUrl = (slug: string) =>
    catalog?.find((entry) => entry.slug === slug)?.llmsTxtUrl ?? ""

  const toggleLibrary = (slug: string, useDocs: boolean) => {
    if (!canEdit) return
    const next = useDocs
      ? [...excluded].filter((entry) => entry !== slug)
      : [...excluded, slug]
    updateRepository.mutate(
      { repositoryId, excludedDocLibraries: next },
      {
        onError: () => toast.error("Failed to update detected libraries"),
      }
    )
  }

  return (
    <SettingsSection
      title="Detected libraries"
      description="Libraries found in this repository's dependency manifests. Reviews automatically reference their documentation unless turned off."
    >
      {detected.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No libraries detected yet – detection runs with the next review of
          this repository.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {detected.map((library) => {
            const isExcluded = excluded.has(library.slug)
            return (
              <li key={library.slug} className="flex items-center gap-2.5">
                <Favicon
                  url={faviconUrl(library.slug)}
                  className={
                    isExcluded ? "size-4 opacity-50 grayscale" : "size-4"
                  }
                />
                <div className="min-w-0 flex-1">
                  <p
                    className={
                      isExcluded
                        ? "truncate text-sm text-muted-foreground"
                        : "truncate text-sm font-medium"
                    }
                  >
                    {library.name}
                  </p>
                  <p
                    className="truncate text-xs text-muted-foreground"
                    title={`Found as "${library.dependency}" in ${library.manifest}`}
                  >
                    {library.manifest}
                  </p>
                </div>
                <Switch
                  checked={!isExcluded}
                  onCheckedChange={(value) =>
                    toggleLibrary(library.slug, value)
                  }
                  disabled={!canEdit || updateRepository.isPending}
                  aria-label={`Use ${library.name} documentation in reviews`}
                />
              </li>
            )
          })}
        </ul>
      )}
    </SettingsSection>
  )
}
