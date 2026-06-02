import { useState } from "react"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
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
import { useWorkspaceBillingCredits } from "@/hooks/use-workspace-billing-credits"
import {
  formatDate,
  formatCreditTransactionAmount,
  formatCreditTransactionType,
} from "@/lib/billing-format"

const PAGE_SIZE = 25

export function CreditHistory({
  workspaceId,
}: {
  workspaceId: string | null | undefined
}) {
  const [page, setPage] = useState(1)
  const { data, isPending } = useWorkspaceBillingCredits(
    workspaceId,
    page,
    PAGE_SIZE,
  )

  const totalPages = data ? Math.ceil(data.total / data.pageSize) : 0

  return (
    <Card>
      <CardHeader>
        <CardTitle>Credit history</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {isPending ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : !data || data.items.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No credit activity yet
          </p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead>Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((item) => {
                  const amount = Number(item.amount)
                  return (
                    <TableRow key={item.id}>
                      <TableCell className="text-muted-foreground">
                        {formatDate(item.createdAt)}
                      </TableCell>
                      <TableCell>
                        {formatCreditTransactionType(item.type)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right tabular-nums",
                          amount > 0
                            ? "text-green-600 dark:text-green-400"
                            : "text-red-600 dark:text-red-400",
                        )}
                      >
                        {formatCreditTransactionAmount(amount)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {Number(item.balanceAfter)}
                      </TableCell>
                      <TableCell className="max-w-56 truncate text-muted-foreground">
                        {item.reason}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>

            {totalPages > 1 && (
              <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
                <span>
                  Page {data.page} of {totalPages}
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="icon-sm"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    <ChevronLeftIcon />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    <ChevronRightIcon />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
