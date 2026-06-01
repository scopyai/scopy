import { generateSignature } from "@creem_io/webhook-types"
import { describe, expect, it, vi } from "vitest"
import { interceptCreemScheduledCancellation } from "./creem-webhook"

const webhookSecret = "test_webhook_secret"
const scheduledCancelPayload = JSON.stringify({
  id: "evt_scheduled_cancel",
  eventType: "subscription.scheduled_cancel",
  created_at: 1_748_796_000_000,
  object: {
    id: "sub_123",
    mode: "test",
    object: "subscription",
    product: {
      id: "prod_ultra",
      mode: "test",
      object: "product",
      name: "Ultra",
      description: "Ultra",
      price: 1000,
      currency: "USD",
      billing_type: "recurring",
      billing_period: "every-month",
      status: "active",
      tax_mode: "exclusive",
      tax_category: "saas",
      created_at: "2026-06-01T00:00:00.000Z",
      updated_at: "2026-06-01T00:00:00.000Z",
    },
    customer: {
      id: "cust_123",
      mode: "test",
      object: "customer",
      email: "owner@example.com",
      country: "US",
      created_at: "2026-06-01T00:00:00.000Z",
      updated_at: "2026-06-01T00:00:00.000Z",
    },
    collection_method: "charge_automatically",
    status: "scheduled_cancel",
    current_period_start_date: "2026-06-01T00:00:00.000Z",
    current_period_end_date: "2026-07-01T00:00:00.000Z",
    canceled_at: null,
    created_at: "2026-06-01T00:00:00.000Z",
    updated_at: "2026-06-01T00:00:00.000Z",
    metadata: { referenceId: "workspace_123" },
  },
})

const requestFor = async (payload: string, secret = webhookSecret) =>
  new Request("http://localhost:3001/api/auth/creem/webhook", {
    method: "POST",
    headers: { "creem-signature": await generateSignature(payload, secret) },
    body: payload,
  })

describe("Creem scheduled-cancellation interception", () => {
  it("handles a valid scheduled-cancel webhook", async () => {
    const handler = vi.fn(async () => undefined)
    const response = await interceptCreemScheduledCancellation(
      await requestFor(scheduledCancelPayload),
      webhookSecret,
      handler
    )

    expect(response?.status).toBe(200)
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        webhookEventType: "subscription.scheduled_cancel",
        webhookId: "evt_scheduled_cancel",
        id: "sub_123",
        status: "scheduled_cancel",
      })
    )
  })

  it("rejects an invalid signature", async () => {
    const handler = vi.fn(async () => undefined)
    const response = await interceptCreemScheduledCancellation(
      await requestFor(scheduledCancelPayload, "wrong_secret"),
      webhookSecret,
      handler
    )

    expect(response?.status).toBe(400)
    expect(handler).not.toHaveBeenCalled()
  })

  it("delegates supported webhook event types", async () => {
    const payload = scheduledCancelPayload.replace(
      "subscription.scheduled_cancel",
      "subscription.active"
    )
    const handler = vi.fn(async () => undefined)
    const response = await interceptCreemScheduledCancellation(
      await requestFor(payload),
      webhookSecret,
      handler
    )

    expect(response).toBeNull()
    expect(handler).not.toHaveBeenCalled()
  })
})
