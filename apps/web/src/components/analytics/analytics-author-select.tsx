import { useMemo, useState } from "react"
import { CheckIcon, ChevronDownIcon, SearchIcon } from "lucide-react"
import { Avatar, AvatarFallback, AvatarImage } from "@workspace/ui/components/avatar"
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

type Author = {
  id: string
  login: string
  avatarUrl: string | null
}

interface AnalyticsAuthorSelectProps {
  value: string | undefined
  onChange: (authorId: string | undefined) => void
  authors: Author[]
  isPending?: boolean
}

function filterAuthors(authors: Author[], query: string) {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return authors

  return authors.filter((author) =>
    author.login.toLowerCase().includes(normalizedQuery),
  )
}

export function AnalyticsAuthorSelect({
  value,
  onChange,
  authors,
  isPending = false,
}: AnalyticsAuthorSelectProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")

  const selectedAuthor = authors.find((author) => author.id === value)
  const triggerLabel =
    selectedAuthor?.login ?? (value ? "Unknown author" : "All authors")

  const filteredAuthors = useMemo(
    () =>
      filterAuthors(authors, search).sort((a, b) =>
        a.login.localeCompare(b.login),
      ),
    [authors, search],
  )

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen)
    if (!nextOpen) setSearch("")
  }

  function handleSelect(authorId: string | undefined) {
    onChange(authorId)
    setOpen(false)
    setSearch("")
  }

  if (isPending) {
    return <Skeleton className="h-9 w-48" />
  }

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="h-9 w-48 justify-between px-2.5 font-normal"
        >
          <span className="flex min-w-0 items-center gap-2">
            {selectedAuthor?.avatarUrl && (
              <Avatar className="size-5">
                <AvatarImage
                  src={selectedAuthor.avatarUrl}
                  alt={selectedAuthor.login}
                />
                <AvatarFallback className="text-[10px]">
                  {selectedAuthor.login[0].toUpperCase()}
                </AvatarFallback>
              </Avatar>
            )}
            <span className="truncate">{triggerLabel}</span>
          </span>
          <ChevronDownIcon className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48 p-0">
        <div className="border-b border-border p-2">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search authors…"
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
          <AuthorOption
            label="All authors"
            selected={!value}
            onSelect={() => handleSelect(undefined)}
          />

          {filteredAuthors.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              No authors match your search
            </p>
          ) : (
            filteredAuthors.map((author) => (
              <AuthorOption
                key={author.id}
                label={author.login}
                avatarUrl={author.avatarUrl}
                selected={value === author.id}
                onSelect={() => handleSelect(author.id)}
              />
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function AuthorOption({
  label,
  avatarUrl,
  selected,
  onSelect,
}: {
  label: string
  avatarUrl?: string | null
  selected: boolean
  onSelect: () => void
}) {
  return (
    <DropdownMenuItem
      onSelect={onSelect}
      className={cn("justify-between gap-2", selected && "bg-accent")}
    >
      <span className="flex min-w-0 items-center gap-2">
        {avatarUrl && (
          <Avatar className="size-5">
            <AvatarImage src={avatarUrl} alt={label} />
            <AvatarFallback className="text-[10px]">
              {label[0].toUpperCase()}
            </AvatarFallback>
          </Avatar>
        )}
        <span className="truncate">{label}</span>
      </span>
      {selected && <CheckIcon className="text-muted-foreground" />}
    </DropdownMenuItem>
  )
}
