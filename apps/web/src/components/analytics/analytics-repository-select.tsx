import { useMemo, useState } from "react"
import { CheckIcon, ChevronDownIcon, SearchIcon } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { Input } from "@workspace/ui/components/input"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"

type Repository = {
  id: string
  name: string
  fullName: string
}

interface AnalyticsRepositorySelectProps {
  value: string | undefined
  onChange: (repositoryId: string | undefined) => void
  repositories: Repository[]
  isPending?: boolean
}

function filterRepositories(repositories: Repository[], query: string) {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return repositories

  return repositories.filter(
    (repo) =>
      repo.name.toLowerCase().includes(normalizedQuery) ||
      repo.fullName.toLowerCase().includes(normalizedQuery),
  )
}

export function AnalyticsRepositorySelect({
  value,
  onChange,
  repositories,
  isPending = false,
}: AnalyticsRepositorySelectProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")

  const selectedRepository = repositories.find((repo) => repo.id === value)
  const triggerLabel = selectedRepository?.fullName ?? "All repositories"

  const filteredRepositories = useMemo(
    () =>
      filterRepositories(repositories, search).sort((a, b) =>
        a.fullName.localeCompare(b.fullName),
      ),
    [repositories, search],
  )

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen)
    if (!nextOpen) setSearch("")
  }

  function handleSelect(repositoryId: string | undefined) {
    onChange(repositoryId)
    setOpen(false)
    setSearch("")
  }

  if (isPending) {
    return <Skeleton className="h-9 w-56" />
  }

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="h-9 w-56 justify-between px-2.5 font-normal"
        >
          <span className="truncate">{triggerLabel}</span>
          <ChevronDownIcon className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56 p-0">
        <div className="border-b border-border p-2">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search repositories…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
              className="h-8 pl-8 text-sm"
              autoFocus
            />
          </div>
        </div>

        <div className="max-h-60 overflow-y-auto p-1">
          <RepositoryOption
            label="All repositories"
            selected={!value}
            onSelect={() => handleSelect(undefined)}
          />

          {filteredRepositories.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              No repositories match your search
            </p>
          ) : (
            filteredRepositories.map((repo) => (
              <RepositoryOption
                key={repo.id}
                label={repo.fullName}
                selected={value === repo.id}
                onSelect={() => handleSelect(repo.id)}
              />
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function RepositoryOption({
  label,
  selected,
  onSelect,
}: {
  label: string
  selected: boolean
  onSelect: () => void
}) {
  return (
    <DropdownMenuItem
      onSelect={onSelect}
      className={cn("justify-between gap-2", selected && "bg-accent")}
    >
      <span className="truncate">{label}</span>
      {selected && <CheckIcon className="text-muted-foreground" />}
    </DropdownMenuItem>
  )
}
