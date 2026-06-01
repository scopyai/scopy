import {
  parseWebhookEvent,
  type NormalizedSubscriptionScheduledCancelEvent,
} from "@creem_io/webhook-types"
import { validateWebhookSignature } from "@creem_io/better-auth/server"

type ScheduledCancelData = {
  webhookEventType: "subscription.scheduled_cancel"
  webhookId: string
  webhookCreatedAt: number
} & NormalizedSubscriptionScheduledCancelEvent["object"]

export const interceptCreemScheduledCancellation = async (
  request: Request,
  webhookSecret: string,
  onScheduledCancel: (data: ScheduledCancelData) => Promise<void>
) => {
  const payload = await request.clone().text()
  const signature = request.headers.get("creem-signature")
  if (!(await validateWebhookSignature(payload, signature, webhookSecret))) {
    return Response.json({ error: "Invalid signature" }, { status: 400 })
  }

  const event = parseWebhookEvent(payload)
  if (event.eventType !== "subscription.scheduled_cancel") return null

  await onScheduledCancel({
    webhookEventType: event.eventType,
    webhookId: event.id,
    webhookCreatedAt: event.created_at,
    ...event.object,
  })
  return Response.json({ message: "Webhook received" })
}
