import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import { Button } from "@workspace/ui/components/button"

export function HistoryPagination({
  page,
  totalPages,
  onPrevious,
  onNext,
}: {
  page: number
  totalPages: number
  onPrevious: () => void
  onNext: () => void
}) {
  const lastPage = Math.max(1, totalPages)

  return (
    <div className="flex items-center justify-between gap-2 border-t pt-3 text-sm text-muted-foreground">
      <span>
        Page {page} of {lastPage}
      </span>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon-sm"
          disabled={page <= 1}
          onClick={onPrevious}
          aria-label="Previous page"
        >
          <ChevronLeftIcon />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          disabled={page >= lastPage}
          onClick={onNext}
          aria-label="Next page"
        >
          <ChevronRightIcon />
        </Button>
      </div>
    </div>
  )
}
