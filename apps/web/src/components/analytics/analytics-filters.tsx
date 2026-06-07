import { Loader2Icon } from "lucide-react"
import type { WorkspaceAnalyticsRange } from "@/hooks/use-workspace-analytics"
import { AnalyticsRangeSelect } from "./analytics-range-select"
import { AnalyticsRepositorySelect } from "./analytics-repository-select"

type Repository = {
  id: string
  name: string
  fullName: string
}

interface AnalyticsFiltersProps {
  range: WorkspaceAnalyticsRange
  onRangeChange: (range: WorkspaceAnalyticsRange) => void
  repositoryId: string | undefined
  onRepositoryChange: (repositoryId: string | undefined) => void
  repositories: Repository[]
  repositoriesPending?: boolean
  isLoading?: boolean
}

export function AnalyticsFilters({
  range,
  onRangeChange,
  repositoryId,
  onRepositoryChange,
  repositories,
  repositoriesPending = false,
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
      {isLoading && (
        <Loader2Icon className="size-3.5 animate-spin text-muted-foreground" />
      )}
    </div>
  )
}
