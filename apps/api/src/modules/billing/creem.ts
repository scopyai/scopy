import { createHmac, timingSafeEqual } from "node:crypto"
import { parseWebhookEvent } from "@creem_io/webhook-types"
import { Creem } from "creem"
import { env } from "../../env"

export const creem = new Creem({
  apiKey: env.CREEM_API_KEY,
  server: env.CREEM_TEST_MODE ? "test" : "prod",
})

export const verifyCreemWebhookSignature = (
  payload: string,
  signature: string | null
) => {
  if (!signature) return false

  const expected = createHmac("sha256", env.CREEM_WEBHOOK_SECRET)
    .update(payload)
    .digest()

  let received: Buffer
  try {
    received = Buffer.from(signature, "hex")
  } catch {
    return false
  }

  return (
    received.length === expected.length && timingSafeEqual(received, expected)
  )
}

export const parseCreemWebhook = (payload: string) => parseWebhookEvent(payload)
