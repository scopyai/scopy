import { useState } from "react"
import { Badge } from "@workspace/ui/components/badge"
import { Skeleton } from "@workspace/ui/components/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import { cn } from "@workspace/ui/lib/utils"
import { useWorkspaceBillingCharges } from "@/hooks/use-workspace-billing-charges"
import {
  formatChargeAmount,
  formatChargeType,
  formatDate,
} from "@/lib/billing-format"
import { tagToneClassName } from "@/lib/tag-tones"
import { HistoryPagination } from "./history-pagination"

const PAGE_SIZE = 25

export function ChargeHistory({
  workspaceId,
}: {
  workspaceId: string | null | undefined
}) {
  const [page, setPage] = useState(1)
  const { data, isFetching, isPending } = useWorkspaceBillingCharges(
    workspaceId,
    page,
    PAGE_SIZE
  )

  const totalPages = data ? Math.ceil(data.total / data.pageSize) : 0

  return (
    <div className="flex flex-col gap-4 rounded-lg border bg-card px-4 py-4">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-sm font-medium">Charges</h3>
        <p className="text-xs text-muted-foreground">
          Payments, refunds, and disputes on your card
        </p>
      </div>
      <div className="flex flex-col gap-4">
        {isPending ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : !data || data.items.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No charges yet
          </p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((item) => {
                  const isCredit = item.type !== "payment"
                  const sign = isCredit ? "+" : "-"
                  const amount = Math.abs(item.amount)
                  return (
                    <TableRow key={item.id}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDate(item.createdAt)}
                      </TableCell>
                      <TableCell>
                        {item.description ?? formatChargeType(item.type)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={tagToneClassName(item.type)}
                        >
                          {formatChargeType(item.type)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground capitalize">
                        {item.status}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right tabular-nums",
                          isCredit && "text-emerald-600 dark:text-emerald-400"
                        )}
                      >
                        {sign}
                        {formatChargeAmount(amount, item.currency)}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>

            <HistoryPagination
              page={page}
              totalPages={totalPages}
              disabled={isFetching}
              onPrevious={() => setPage((p) => p - 1)}
              onNext={() => setPage((p) => p + 1)}
            />
          </>
        )}
      </div>
    </div>
  )
}
