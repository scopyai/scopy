import { Loader2Icon } from "lucide-react"
import type { WorkspaceAnalyticsRange } from "@/hooks/use-workspace-analytics"
import { AnalyticsAuthorSelect } from "./analytics-author-select"
import { AnalyticsRangeSelect } from "./analytics-range-select"
import { AnalyticsRepositorySelect } from "./analytics-repository-select"

type Repository = {
  id: string
  name: string
  fullName: string
}

type Author = {
  id: string
  login: string
  avatarUrl: string | null
}

interface AnalyticsFiltersProps {
  range: WorkspaceAnalyticsRange
  onRangeChange: (range: WorkspaceAnalyticsRange) => void
  repositoryId: string | undefined
  onRepositoryChange: (repositoryId: string | undefined) => void
  repositories: Repository[]
  repositoriesPending?: boolean
  authorId: string | undefined
  onAuthorChange: (authorId: string | undefined) => void
  authors: Author[]
  authorsPending?: boolean
  isLoading?: boolean
}

export function AnalyticsFilters({
  range,
  onRangeChange,
  repositoryId,
  onRepositoryChange,
  repositories,
  repositoriesPending = false,
  authorId,
  onAuthorChange,
  authors,
  authorsPending = false,
  isLoading = false,
}: AnalyticsFiltersProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <AnalyticsRangeSelect value={range} onChange={onRangeChange} />
      <AnalyticsRepositorySelect
        value={repositoryId}
        onChange={onRepositoryChange}
        repositories={repositories}
        isPending={repositoriesPending}
      />
      <AnalyticsAuthorSelect
        value={authorId}
        onChange={onAuthorChange}
        authors={authors}
        isPending={authorsPending}
      />
      {isLoading && (
        <Loader2Icon className="size-3.5 animate-spin text-muted-foreground" />
      )}
    </div>
  )
}
