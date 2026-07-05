import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs"
import { UsageHistory } from "./usage-history"
import { ChargeHistory } from "./charge-history"

export function BillingHistory({
  workspaceId,
}: {
  workspaceId: string | null | undefined
}) {
  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">History</h2>
        <p className="text-sm text-muted-foreground">
          Track how you consume your limits and how you're charged
        </p>
      </div>

      <Tabs defaultValue="usage">
        <TabsList>
          <TabsTrigger value="usage">Usage</TabsTrigger>
          <TabsTrigger value="charges">Charges</TabsTrigger>
        </TabsList>
        <TabsContent value="usage">
          <UsageHistory workspaceId={workspaceId} />
        </TabsContent>
        <TabsContent value="charges">
          <ChargeHistory workspaceId={workspaceId} />
        </TabsContent>
      </Tabs>
    </section>
  )
}
