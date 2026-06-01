import { describe, expect, it } from "vitest"
import {
  calculateResetDelta,
  canConsumeCredits,
  getPlanChangeKind,
  periodGrantKey,
  shouldRevokeForSubscriptionStatus,
} from "./policy"

describe("billing policy", () => {
  it("classifies supported plan changes", () => {
    expect(getPlanChangeKind("premium", "ultra")).toBe("upgrade")
    expect(getPlanChangeKind("ultra", "premium")).toBe("downgrade")
    expect(getPlanChangeKind("premium", "premium")).toBe("same")
    expect(getPlanChangeKind("free", "premium")).toBe("unsupported")
  })

  it("resets the allowance while burning any remainder", () => {
    expect(calculateResetDelta(35, 100)).toBe(65)
    expect(calculateResetDelta(500, 100)).toBe(-400)
  })

  it("rejects overdrafts and invalid consumption amounts", () => {
    expect(canConsumeCredits(10, 10)).toBe(true)
    expect(canConsumeCredits(10, 11)).toBe(false)
    expect(canConsumeCredits(10, 0)).toBe(false)
    expect(canConsumeCredits(10, 1.5)).toBe(false)
  })

  it("uses a stable monthly grant idempotency key", () => {
    expect(
      periodGrantKey(
        "sub_123",
        "prod_ultra",
        new Date("2026-06-01T00:00:00.000Z")
      )
    ).toBe("sub_123:prod_ultra:2026-06-01T00:00:00.000Z:grant")
  })

  it("revokes credits only for terminal access states", () => {
    expect(shouldRevokeForSubscriptionStatus("paused")).toBe(true)
    expect(shouldRevokeForSubscriptionStatus("expired")).toBe(true)
    expect(shouldRevokeForSubscriptionStatus("past_due")).toBe(false)
    expect(shouldRevokeForSubscriptionStatus("unpaid")).toBe(false)
    expect(shouldRevokeForSubscriptionStatus("scheduled_cancel")).toBe(false)
  })
})
