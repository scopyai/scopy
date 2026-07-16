import { useEffect, useMemo, useState } from "react"
import {
  CheckCircle2Icon,
  Loader2Icon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog"
import { Input } from "@workspace/ui/components/input"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { cn } from "@workspace/ui/lib/utils"
import { Favicon, urlHost } from "@/components/repositories/favicon"
import { useDocsCatalog } from "@/hooks/use-docs-catalog"
import {
  useCrawlWorkspaceDocSource,
  useCreateWorkspaceDocSource,
  useDeleteWorkspaceDocSource,
  useWorkspaceDocSources,
} from "@/hooks/use-workspace-doc-sources"

type CatalogEntry = { slug: string; name: string; llmsTxtUrl: string }

function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}

function normalizedDocUrl(raw: string): string | null {
  const trimmed = raw.trim()
  if (trimmed.length < 4) return null
  try {
    const url = new URL(
      trimmed.includes("://") ? trimmed : `https://${trimmed}`
    )
    const host = url.hostname.toLowerCase().replace(/^www\./, "")
    return `${host}${url.pathname.replace(/\/+$/, "")}`
  } catch {
    return null
  }
}

function findBuiltInMatch(
  catalog: CatalogEntry[] | undefined,
  name: string,
  url: string
): CatalogEntry | null {
  if (!catalog) return null
  const trimmedName = name.trim().toLowerCase()
  const normalizedUrl = normalizedDocUrl(url)
  for (const entry of catalog) {
    if (normalizedUrl && normalizedDocUrl(entry.llmsTxtUrl) === normalizedUrl) {
      return entry
    }
    if (
      trimmedName.length >= 3 &&
      (entry.name.toLowerCase() === trimmedName ||
        entry.slug === trimmedName.replace(/\s+/g, "-"))
    ) {
      return entry
    }
  }
  return null
}

function BuiltInCatalog({ catalog }: { catalog: CatalogEntry[] | undefined }) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState("")

  const filtered = useMemo(() => {
    if (!catalog) return []
    const query = filter.trim().toLowerCase()
    if (!query) return catalog
    return catalog.filter(
      (entry) =>
        entry.name.toLowerCase().includes(query) ||
        entry.llmsTxtUrl.toLowerCase().includes(query)
    )
  }, [catalog, filter])

  if (!catalog?.length) return null

  const preview = catalog.slice(0, 3)
  const stack = catalog.slice(0, 7)

  return (
    <div className="mt-2 flex items-center gap-2.5">
      <div className="flex shrink-0 items-center -space-x-1.5">
        {stack.map((entry) => (
          <span
            key={entry.slug}
            title={entry.name}
            className="flex size-5 items-center justify-center overflow-hidden rounded-full bg-muted ring-2 ring-background"
          >
            <Favicon url={entry.llmsTxtUrl} className="size-3" />
          </span>
        ))}
      </div>
      <p className="min-w-0 truncate text-xs text-muted-foreground">
        {preview.map((entry) => entry.name).join(", ")}, and{" "}
        {catalog.length - preview.length} more libraries and SDKs are included by
        default.
      </p>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          setOpen(value)
          if (!value) setFilter("")
        }}
      >
        <DialogTrigger asChild>
          <button
            type="button"
            className="shrink-0 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            View all
          </button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Built-in documentation</DialogTitle>
            <DialogDescription>
              These libraries are indexed by default — reviews reference them
              automatically.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={`Search ${catalog.length} libraries`}
            autoFocus
          />
          <div className="grid h-72 grid-cols-2 content-start gap-x-2 overflow-y-auto sm:grid-cols-3">
            {filtered.map((entry) => (
              <div
                key={entry.slug}
                className="flex items-center gap-2 rounded-md px-1.5 py-1.5"
                title={entry.llmsTxtUrl}
              >
                <Favicon url={entry.llmsTxtUrl} className="size-4" />
                <span className="truncate text-sm">{entry.name}</span>
              </div>
            ))}
            {filtered.length === 0 ? (
              <p className="col-span-full px-1.5 py-1.5 text-xs text-muted-foreground">
                No matches — add it as a custom source instead.
              </p>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function SourceStatusBadge({
  status,
  activePageCount,
  lastError,
}: {
  status: string
  activePageCount: number
  lastError: string | null
}) {
  if (status === "crawling") {
    return (
      <Badge variant="secondary" className="gap-1">
        <Loader2Icon className="size-3 animate-spin" />
        Crawling
      </Badge>
    )
  }
  if (status === "error") {
    return (
      <Badge variant="destructive" title={lastError ?? undefined}>
        Error
      </Badge>
    )
  }
  if (activePageCount > 0) {
    return <Badge variant="secondary">{activePageCount} pages</Badge>
  }
  return <Badge variant="outline">Queued</Badge>
}

export function WorkspaceDocSources({
  workspaceId,
  canEdit,
}: {
  workspaceId: string
  canEdit: boolean
}) {
  const { data: sources, isPending } = useWorkspaceDocSources(workspaceId)
  const { data: catalog } = useDocsCatalog()
  const createSource = useCreateWorkspaceDocSource(workspaceId)
  const deleteSource = useDeleteWorkspaceDocSource(workspaceId)
  const crawlSource = useCrawlWorkspaceDocSource(workspaceId)

  const [name, setName] = useState("")
  const [url, setUrl] = useState("")

  const builtInMatch = useMemo(
    () => findBuiltInMatch(catalog, name, url),
    [catalog, name, url]
  )

  const debouncedUrl = useDebouncedValue(url, 400)
  const urlFaviconHost = useMemo(() => {
    const host = urlHost(debouncedUrl.trim())
    return host && /\.[a-z]{2,}$/i.test(host) ? host : null
  }, [debouncedUrl])

  const handleAdd = () => {
    const trimmedName = name.trim()
    const trimmedUrl = url.trim()
    if (!trimmedName || !trimmedUrl) return
    createSource.mutate(
      { name: trimmedName, llmsTxtUrl: trimmedUrl },
      {
        onSuccess: () => {
          setName("")
          setUrl("")
        },
      }
    )
  }

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-medium text-foreground">
          Custom documentation
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Point Scopy at an llms.txt file for internal or niche libraries so
          reviews can reference their documentation. Only visible to this
          workspace.
        </p>
      </div>

      {isPending ? (
        <Skeleton className="h-12 w-full rounded-lg" />
      ) : (
        <div className="flex flex-col gap-2">
          {(sources ?? []).map((source) => (
            <div
              key={source.id}
              className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3"
            >
              <Favicon url={source.llmsTxtUrl} className="size-4" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{source.name}</p>
                <p
                  className="truncate text-xs text-muted-foreground"
                  title={source.llmsTxtUrl}
                >
                  {source.llmsTxtUrl}
                </p>
                {source.status === "error" && source.lastError ? (
                  <p className="truncate text-xs text-destructive">
                    {source.lastError}
                  </p>
                ) : null}
              </div>
              <SourceStatusBadge
                status={source.status}
                activePageCount={source.activePageCount}
                lastError={source.lastError}
              />
              {canEdit ? (
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Recrawl"
                    disabled={
                      crawlSource.isPending || source.status === "crawling"
                    }
                    onClick={() => crawlSource.mutate(source.id)}
                  >
                    <RefreshCwIcon className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Remove"
                    disabled={deleteSource.isPending}
                    onClick={() => deleteSource.mutate(source.id)}
                  >
                    <Trash2Icon className="size-3.5" />
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
          {sources?.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-4 py-3 text-xs text-muted-foreground">
              No custom documentation sources yet.
            </p>
          ) : null}
        </div>
      )}

      {canEdit ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Name (e.g. Internal SDK)"
              className="sm:max-w-48"
              maxLength={80}
            />
            <div className="relative min-w-0 flex-1">
              {urlFaviconHost ? (
                <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2">
                  <Favicon
                    key={urlFaviconHost}
                    url={`https://${urlFaviconHost}`}
                    className="size-4"
                  />
                </span>
              ) : null}
              <Input
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://docs.example.com/llms.txt"
                type="url"
                className={cn(urlFaviconHost && "pl-8")}
                onKeyDown={(event) => {
                  if (event.key === "Enter") handleAdd()
                }}
              />
            </div>
            <Button
              variant="outline"
              onClick={handleAdd}
              disabled={
                createSource.isPending ||
                !name.trim() ||
                !url.trim() ||
                !!builtInMatch
              }
            >
              {createSource.isPending ? "Adding…" : "Add source"}
            </Button>
          </div>
          {builtInMatch ? (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2">
              <Favicon url={builtInMatch.llmsTxtUrl} className="size-3.5" />
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">
                  {builtInMatch.name}
                </span>{" "}
                documentation is already included by default — Scopy uses it
                automatically.
              </p>
              <CheckCircle2Icon className="ml-auto size-3.5 shrink-0 text-primary/70" />
            </div>
          ) : null}
        </div>
      ) : null}

      <BuiltInCatalog catalog={catalog} />
    </section>
  )
}
