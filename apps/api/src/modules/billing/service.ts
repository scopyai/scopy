import { randomUUID } from "node:crypto"
import type {
  NormalizedCheckoutCompletedEvent,
  NormalizedDisputeCreatedEvent,
  NormalizedRefundCreatedEvent,
  NormalizedSubscriptionEntity,
  NormalizedWebhookEvent,
} from "@creem_io/webhook-types"
import { eq, sql } from "drizzle-orm"
import { db } from "../../db/client"
import { user, workspace, workspaceCreditTransaction } from "../../db/schema"
import { env } from "../../env"
import { creem } from "./creem"
import {
  getMonthlyAllowance,
  getPlanByProductId,
  getPurchasablePlan,
  isPaidTier,
  publicBillingPlans,
  type PurchasableBillingTier,
} from "./plans"
import {
  calculateResetDelta,
  getPlanChangeKind,
  getWorkspaceReferenceId,
  isStaleCreemEvent,
  periodResetKey,
  shouldRevokeForSubscriptionStatus,
} from "./policy"

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
type CreditResetSubscription = {
  id: string
  productId: string
  customerId: string
  status: string
  periodStart: Date
  periodEnd: Date
}

const STARTER_CHECKOUT_RESERVATION_TTL_MS = 60 * 60 * 1000

const toDate = (value: Date | string | number, field: string) => {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid Creem ${field}: ${String(value)}`)
  }
  return date
}

export class BillingError extends Error {
  constructor(
    message: string,
    public readonly statusCode: 400 | 404 | 409 = 400,
  ) {
    super(message)
    this.name = "BillingError"
  }
}

const lockWorkspace = async (tx: Transaction, workspaceId: string) => {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${workspaceId}))`)
}

const getWorkspace = async (workspaceId: string) =>
  (await db.query.workspace.findFirst({
    where: eq(workspace.id, workspaceId),
  })) ?? null

const createPendingStarterCheckoutId = (requestId: string) =>
  `pending:${Date.now()}:${requestId}`

const parsePendingStarterCheckoutId = (value: string | null) => {
  if (!value?.startsWith("pending:")) return null
  const parts = value.split(":")
  if (parts.length === 2) {
    return { createdAt: null, requestId: parts[1] }
  }
  const createdAt = Number(parts[1])
  if (!Number.isFinite(createdAt)) return null
  return { createdAt, requestId: parts.slice(2).join(":") }
}

const hasActiveStarterCheckoutReservation = (value: string | null) => {
  const pending = parsePendingStarterCheckoutId(value)
  if (!pending) return Boolean(value)
  if (!pending.createdAt) return true
  return Date.now() - pending.createdAt < STARTER_CHECKOUT_RESERVATION_TTL_MS
}

const matchesStarterCheckoutReservation = (
  value: string | null,
  checkoutId: string,
  requestId: string | null,
) => {
  if (!value) return true
  if (value === checkoutId) return true
  const pending = parsePendingStarterCheckoutId(value)
  return Boolean(pending && requestId && pending.requestId === requestId)
}

const getCheckoutRequestId = (
  checkout:
    | NormalizedCheckoutCompletedEvent["object"]
    | Exclude<
        NormalizedRefundCreatedEvent["object"]["checkout"],
        string | undefined
      >,
) =>
  checkout.request_id ??
  (typeof checkout.metadata?.starterRequestId === "string"
    ? checkout.metadata.starterRequestId
    : null)

const getCheckoutProductId = (
  checkout:
    | NormalizedCheckoutCompletedEvent["object"]
    | Exclude<
        NormalizedRefundCreatedEvent["object"]["checkout"],
        string | undefined
      >,
) => (typeof checkout.product === "string" ? checkout.product : checkout.product.id)

const getCheckoutUserId = (
  checkout:
    | NormalizedCheckoutCompletedEvent["object"]
    | Exclude<
        NormalizedRefundCreatedEvent["object"]["checkout"],
        string | undefined
      >,
) => (typeof checkout.metadata?.userId === "string" ? checkout.metadata.userId : null)

const toBillingAccount = (value: typeof workspace.$inferSelect) => ({
  workspaceId: value.id,
  tier: value.billingTier,
  status: value.billingStatus,
  periodStart: value.billingPeriodStart,
  periodEnd: value.billingPeriodEnd,
  pendingTier: value.pendingBillingTier,
  pendingChangeAt: value.pendingBillingTier ? value.billingPeriodEnd : null,
  cancelAtPeriodEnd: value.billingStatus === "scheduled_cancel",
  monthlyAllowance: getMonthlyAllowance(value.billingTier),
  creditBalance: value.creditBalance,
  creemCustomerId: value.creemCustomerId,
  creemSubscriptionId: value.creemSubscriptionId,
})

type CreditHistoryRow = {
  id: string
  type: "usage_week" | "reset" | "revoke" | "starter_grant"
  amount: number
  balanceAfter: number
  reason: string
  createdAt: Date
  periodStart: Date | null
  periodEnd: Date | null
  transactionCount: number
}

const toHistoryDate = (value: Date | string) =>
  value instanceof Date ? value : new Date(value)

const resolveWorkspace = async (
  tx: Transaction,
  metadata: Record<string, string | number | null> | undefined,
  subscriptionId: string | null,
) => {
  const referenceId = getWorkspaceReferenceId(metadata)
  if (referenceId) {
    return tx.query.workspace.findFirst({ where: eq(workspace.id, referenceId) })
  }

  return subscriptionId
    ? tx.query.workspace.findFirst({
        where: eq(workspace.creemSubscriptionId, subscriptionId),
      })
    : null
}

const appendTransaction = async (
  tx: Transaction,
  values: {
    workspaceId: string
    type: "reset" | "revoke"
    amount: number
    balanceAfter: number
    idempotencyKey: string
    reason: string
    metadata?: Record<string, unknown>
  },
) => {
  await tx
    .insert(workspaceCreditTransaction)
    .values({
      id: randomUUID(),
      ...values,
      metadata: values.metadata ?? {},
    })
    .onConflictDoNothing({
      target: workspaceCreditTransaction.idempotencyKey,
    })
}

const resetCredits = async (
  tx: Transaction,
  currentWorkspace: typeof workspace.$inferSelect,
  subscription: CreditResetSubscription,
  reason: string,
) => {
  const plan = getPlanByProductId(subscription.productId)
  if (!plan) throw new BillingError(`Unknown Creem product: ${subscription.productId}`)

  const idempotencyKey = periodResetKey(
    subscription.id,
    subscription.productId,
    subscription.periodStart,
  )
  const existing = await tx.query.workspaceCreditTransaction.findFirst({
    where: eq(workspaceCreditTransaction.idempotencyKey, idempotencyKey),
  })
  if (existing) return

  await tx
    .update(workspace)
    .set({
      billingTier: plan.slug,
      billingStatus: subscription.status,
      creditBalance: plan.monthlyCredits,
      creemCustomerId: subscription.customerId,
      creemSubscriptionId: subscription.id,
      billingPeriodStart: subscription.periodStart,
      billingPeriodEnd: subscription.periodEnd,
      pendingBillingTier: null,
      updatedAt: new Date(),
    })
    .where(eq(workspace.id, currentWorkspace.id))

  await appendTransaction(tx, {
    workspaceId: currentWorkspace.id,
    type: "reset",
    amount: calculateResetDelta(currentWorkspace.creditBalance, plan.monthlyCredits),
    balanceAfter: plan.monthlyCredits,
    idempotencyKey,
    reason,
    metadata: {
      subscriptionId: subscription.id,
      productId: subscription.productId,
      periodStart: subscription.periodStart.toISOString(),
    },
  })
}

const revokeCredits = async (
  tx: Transaction,
  currentWorkspace: typeof workspace.$inferSelect,
  idempotencyKey: string,
  reason: string,
  status?: string,
) => {
  const existing = await tx.query.workspaceCreditTransaction.findFirst({
    where: eq(workspaceCreditTransaction.idempotencyKey, idempotencyKey),
  })
  if (existing) return

  await tx
    .update(workspace)
    .set({
      ...(status
        ? {
            billingTier: "free" as const,
            billingStatus: status,
            pendingBillingTier: null,
          }
        : {}),
      creditBalance: 0,
      updatedAt: new Date(),
    })
    .where(eq(workspace.id, currentWorkspace.id))

  await appendTransaction(tx, {
    workspaceId: currentWorkspace.id,
    type: "revoke",
    amount: -currentWorkspace.creditBalance,
    balanceAfter: 0,
    idempotencyKey,
    reason,
  })
}

const applySubscriptionEvent = async (
  event: Extract<NormalizedWebhookEvent, { object: NormalizedSubscriptionEntity }>,
) => {
  await db.transaction(async (tx) => {
    const subscription = event.object
    const currentWorkspace = await resolveWorkspace(
      tx,
      subscription.metadata,
      subscription.id,
    )
    if (!currentWorkspace) return

    await lockWorkspace(tx, currentWorkspace.id)
    const lockedWorkspace = await tx.query.workspace.findFirst({
      where: eq(workspace.id, currentWorkspace.id),
    })
    if (!lockedWorkspace) return
    if (isStaleCreemEvent(lockedWorkspace.creemLastEventAt, new Date(event.created_at))) {
      return
    }

    if (event.eventType === "subscription.paid") {
      const periodStart = toDate(
        subscription.current_period_start_date,
        "subscription period start",
      )
      const periodEnd = toDate(
        subscription.current_period_end_date,
        "subscription period end",
      )
      await resetCredits(
        tx,
        lockedWorkspace,
        {
          id: subscription.id,
          productId: subscription.product.id,
          customerId: subscription.customer.id,
          status: subscription.status,
          periodStart,
          periodEnd,
        },
        "subscription_paid",
      )
    } else if (shouldRevokeForSubscriptionStatus(subscription.status)) {
      await revokeCredits(
        tx,
        lockedWorkspace,
        `${event.id}:revoke`,
        `subscription_${subscription.status}`,
        subscription.status,
      )
    } else {
      const plan = getPlanByProductId(subscription.product.id)
      const preservePendingDowngrade =
        lockedWorkspace.billingTier === "ultra" &&
        lockedWorkspace.pendingBillingTier === "premium" &&
        plan?.slug === "premium"
      const periodStart = toDate(
        subscription.current_period_start_date,
        "subscription period start",
      )
      const periodEnd = toDate(
        subscription.current_period_end_date,
        "subscription period end",
      )

      await tx
        .update(workspace)
        .set({
          billingTier: preservePendingDowngrade
            ? lockedWorkspace.billingTier
            : plan?.slug ?? lockedWorkspace.billingTier,
          billingStatus: subscription.status,
          creemCustomerId: subscription.customer.id,
          creemSubscriptionId: subscription.id,
          billingPeriodStart: periodStart,
          billingPeriodEnd: periodEnd,
          pendingBillingTier:
            subscription.status === "scheduled_cancel"
              ? null
              : lockedWorkspace.pendingBillingTier,
          updatedAt: new Date(),
        })
        .where(eq(workspace.id, currentWorkspace.id))
    }

    await tx
      .update(workspace)
      .set({ creemLastEventAt: new Date(event.created_at) })
      .where(eq(workspace.id, currentWorkspace.id))
  })
}

const grantStarter = async (
  event: NormalizedCheckoutCompletedEvent,
  workspaceId: string,
) => {
  const userId =
    typeof event.object.metadata?.userId === "string"
      ? event.object.metadata.userId
      : null
  if (!userId) return
  const checkoutId = event.object.id
  const checkoutRequestId = getCheckoutRequestId(event.object)

  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`)
    const currentUser = await tx.query.user.findFirst({
      where: eq(user.id, userId),
    })
    if (!currentUser || currentUser.starterGrantedAt) return
    if (
      !matchesStarterCheckoutReservation(
        currentUser.starterCreemCheckoutId,
        checkoutId,
        checkoutRequestId,
      )
    ) {
      return
    }

    await lockWorkspace(tx, workspaceId)
    const currentWorkspace = await tx.query.workspace.findFirst({
      where: eq(workspace.id, workspaceId),
    })
    if (!currentWorkspace) return
    if (isPaidTier(currentWorkspace.billingTier)) {
      await tx
        .update(user)
        .set({ starterGrantedAt: new Date(), starterCreemCheckoutId: checkoutId })
        .where(eq(user.id, userId))
      return
    }

    const balanceAfter =
      currentWorkspace.creditBalance + env.STARTER_CREDIT_MICRO_USD
    await tx
      .update(workspace)
      .set({ creditBalance: balanceAfter, updatedAt: new Date() })
      .where(eq(workspace.id, workspaceId))
    await tx
      .update(user)
      .set({ starterGrantedAt: new Date(), starterCreemCheckoutId: checkoutId })
      .where(eq(user.id, userId))
    await tx
      .insert(workspaceCreditTransaction)
      .values({
        id: randomUUID(),
        workspaceId,
        type: "starter_grant",
        amount: env.STARTER_CREDIT_MICRO_USD,
        balanceAfter,
        idempotencyKey: `starter:${checkoutId}`,
        reason: "starter_purchase",
        metadata: { userId, checkoutId },
      })
      .onConflictDoNothing({
        target: workspaceCreditTransaction.idempotencyKey,
      })
  })
}

const getEntityId = (value: { id: string } | string | undefined) =>
  typeof value === "string" ? value : value?.id ?? null

const getFinancialCheckout = (
  event: NormalizedRefundCreatedEvent | NormalizedDisputeCreatedEvent,
) => (typeof event.object.checkout === "object" ? event.object.checkout : null)

const applyStarterFinancialRevoke = async (
  event: NormalizedRefundCreatedEvent | NormalizedDisputeCreatedEvent,
) => {
  const checkoutId = getEntityId(event.object.checkout)
  if (!checkoutId) return false
  const checkout = getFinancialCheckout(event)
  const checkoutRequestId = checkout ? getCheckoutRequestId(checkout) : null
  const checkoutUserId = checkout ? getCheckoutUserId(checkout) : null
  const checkoutWorkspaceId = checkout
    ? getWorkspaceReferenceId(checkout.metadata)
    : null
  const isStarterCheckout =
    checkout ? getCheckoutProductId(checkout) === env.CREEM_STARTER_PRODUCT_ID : false

  return db.transaction(async (tx) => {
    const currentUser = checkoutUserId
      ? await tx.query.user.findFirst({ where: eq(user.id, checkoutUserId) })
      : await tx.query.user.findFirst({
          where: eq(user.starterCreemCheckoutId, checkoutId),
        })
    if (!currentUser) return false
    if (!isStarterCheckout && currentUser.starterCreemCheckoutId !== checkoutId) {
      return false
    }
    if (
      !matchesStarterCheckoutReservation(
        currentUser.starterCreemCheckoutId,
        checkoutId,
        checkoutRequestId,
      )
    ) {
      return false
    }

    const grantTransaction = await tx.query.workspaceCreditTransaction.findFirst({
      where: eq(workspaceCreditTransaction.idempotencyKey, `starter:${checkoutId}`),
    })
    const workspaceId = grantTransaction?.workspaceId ?? checkoutWorkspaceId
    if (!workspaceId) {
      await tx
        .update(user)
        .set({ starterGrantedAt: new Date(), starterCreemCheckoutId: checkoutId })
        .where(eq(user.id, currentUser.id))
      return true
    }

    await lockWorkspace(tx, workspaceId)
    const currentWorkspace = await tx.query.workspace.findFirst({
      where: eq(workspace.id, workspaceId),
    })
    if (!currentWorkspace) return false

    const idempotencyKey = `starter:${checkoutId}:${event.eventType}:revoke`
    const existing = await tx.query.workspaceCreditTransaction.findFirst({
      where: eq(workspaceCreditTransaction.idempotencyKey, idempotencyKey),
    })
    if (existing) return true

    const revokeAmount = isPaidTier(currentWorkspace.billingTier)
      ? 0
      : Math.min(
          Math.max(currentWorkspace.creditBalance, 0),
          env.STARTER_CREDIT_MICRO_USD,
        )
    const balanceAfter = currentWorkspace.creditBalance - revokeAmount
    await tx
      .update(workspace)
      .set({ creditBalance: balanceAfter, updatedAt: new Date() })
      .where(eq(workspace.id, currentWorkspace.id))

    await appendTransaction(tx, {
      workspaceId: currentWorkspace.id,
      type: "revoke",
      amount: -revokeAmount,
      balanceAfter,
      idempotencyKey,
      reason: event.eventType,
      metadata: { userId: currentUser.id, checkoutId },
    })
    await tx
      .update(user)
      .set({ starterGrantedAt: new Date(), starterCreemCheckoutId: checkoutId })
      .where(eq(user.id, currentUser.id))
    return true
  })
}

const applyCheckoutCompleted = async (event: NormalizedCheckoutCompletedEvent) => {
  const referenceId = getWorkspaceReferenceId(event.object.metadata)
  if (!referenceId) return

  if (event.object.product.id === env.CREEM_STARTER_PRODUCT_ID) {
    return grantStarter(event, referenceId)
  }

  const subscriptionId =
    typeof event.object.subscription === "object"
      ? event.object.subscription.id
      : event.object.subscription ?? null
  await db
    .update(workspace)
    .set({
      creemCustomerId: event.object.customer?.id ?? null,
      creemSubscriptionId: subscriptionId,
      updatedAt: new Date(),
    })
    .where(eq(workspace.id, referenceId))
}

const getFinancialSubscriptionId = (
  event: NormalizedRefundCreatedEvent | NormalizedDisputeCreatedEvent,
) =>
  typeof event.object.subscription === "string"
    ? event.object.subscription
    : event.object.subscription?.id ?? event.object.transaction.subscription ?? null

const applyFinancialRevoke = async (
  event: NormalizedRefundCreatedEvent | NormalizedDisputeCreatedEvent,
) => {
  if (await applyStarterFinancialRevoke(event)) return

  const subscriptionId = getFinancialSubscriptionId(event)
  if (!subscriptionId) return

  await db.transaction(async (tx) => {
    const currentWorkspace = await resolveWorkspace(tx, undefined, subscriptionId)
    if (!currentWorkspace) return
    await lockWorkspace(tx, currentWorkspace.id)
    const lockedWorkspace = await tx.query.workspace.findFirst({
      where: eq(workspace.id, currentWorkspace.id),
    })
    if (!lockedWorkspace) return
    await revokeCredits(tx, lockedWorkspace, `${event.id}:revoke`, event.eventType)
  })
}

export const applyCreemWebhook = async (event: NormalizedWebhookEvent) => {
  if (event.eventType === "checkout.completed") return applyCheckoutCompleted(event)
  if (event.eventType === "refund.created" || event.eventType === "dispute.created") {
    return applyFinancialRevoke(event)
  }
  return applySubscriptionEvent(event)
}

export const getWorkspaceBilling = async (
  workspaceId: string,
  userId?: string,
) => {
  const currentWorkspace = await getWorkspace(workspaceId)
  if (!currentWorkspace) throw new BillingError("Workspace not found", 404)
  const currentUser = userId
    ? await db.query.user.findFirst({
        where: eq(user.id, userId),
        columns: { starterGrantedAt: true },
      })
    : null
  return {
    plans: publicBillingPlans,
    account: toBillingAccount(currentWorkspace),
    starterUsed: Boolean(currentUser?.starterGrantedAt),
  }
}

export const listWorkspaceCreditTransactions = async (
  workspaceId: string,
  page: number,
  pageSize: number,
) => {
  const offset = (page - 1) * pageSize
  const usageRows = await db
    .select({
      id: sql<string>`'usage-week:' || to_char(date_trunc('week', ${workspaceCreditTransaction.createdAt}), 'YYYY-MM-DD')`,
      type: sql<CreditHistoryRow["type"]>`'usage_week'`,
      amount: sql<number>`sum(${workspaceCreditTransaction.amount})::bigint`,
      balanceAfter: sql<number>`(array_agg(${workspaceCreditTransaction.balanceAfter} order by ${workspaceCreditTransaction.createdAt} desc))[1]::bigint`,
      reason: sql<string>`'weekly_review_usage'`,
      createdAt: sql<Date>`max(${workspaceCreditTransaction.createdAt})`,
      periodStart: sql<Date>`date_trunc('week', ${workspaceCreditTransaction.createdAt})`,
      periodEnd: sql<Date>`date_trunc('week', ${workspaceCreditTransaction.createdAt}) + interval '7 days'`,
      transactionCount: sql<number>`count(*)::int`,
    })
    .from(workspaceCreditTransaction)
    .where(sql`${workspaceCreditTransaction.workspaceId} = ${workspaceId} and ${workspaceCreditTransaction.type} = 'usage_debit'`)
    .groupBy(sql`date_trunc('week', ${workspaceCreditTransaction.createdAt})`)

  const adjustmentRows = await db
    .select({
      id: workspaceCreditTransaction.id,
      type: sql<CreditHistoryRow["type"]>`${workspaceCreditTransaction.type}`,
      amount: workspaceCreditTransaction.amount,
      balanceAfter: workspaceCreditTransaction.balanceAfter,
      reason: workspaceCreditTransaction.reason,
      createdAt: workspaceCreditTransaction.createdAt,
      periodStart: sql<Date | null>`null`,
      periodEnd: sql<Date | null>`null`,
      transactionCount: sql<number>`1`,
    })
    .from(workspaceCreditTransaction)
    .where(sql`${workspaceCreditTransaction.workspaceId} = ${workspaceId} and ${workspaceCreditTransaction.type} <> 'usage_debit'`)

  const rows: CreditHistoryRow[] = [...usageRows, ...adjustmentRows]
    .map((row) => ({
      ...row,
      amount: Number(row.amount),
      balanceAfter: Number(row.balanceAfter),
      createdAt: toHistoryDate(row.createdAt),
      periodStart: row.periodStart ? toHistoryDate(row.periodStart) : null,
      periodEnd: row.periodEnd ? toHistoryDate(row.periodEnd) : null,
    }))
    .sort((a, b) => {
      const aSortDate = a.periodEnd ?? a.createdAt
      const bSortDate = b.periodEnd ?? b.createdAt
      return bSortDate.getTime() - aSortDate.getTime()
    })
  const items = rows.slice(offset, offset + pageSize)

  return { items, page, pageSize, total: rows.length }
}

export const createWorkspaceCheckout = async (
  workspaceId: string,
  email: string,
  tier: string,
  requestId: string,
) => {
  const plan = getPurchasablePlan(tier)
  if (!plan) throw new BillingError("Unknown purchasable billing tier")
  const currentWorkspace = await getWorkspace(workspaceId)
  if (!currentWorkspace) throw new BillingError("Workspace not found", 404)
  if (isPaidTier(currentWorkspace.billingTier)) {
    throw new BillingError("Workspace already has a billing plan", 409)
  }

  const checkout = await creem.checkouts.create({
    productId: plan.productId,
    requestId,
    customer: { email },
    successUrl: new URL(
      `/${encodeURIComponent(currentWorkspace.providerAccountLogin)}/billing/success?workspaceId=${encodeURIComponent(workspaceId)}`,
      env.FRONTEND_URL,
    ).toString(),
    metadata: { referenceId: workspaceId },
  })
  if (!checkout.checkoutUrl) {
    throw new Error("Creem checkout did not include a redirect URL")
  }
  return { url: checkout.checkoutUrl }
}

export const createStarterCheckout = async (
  workspaceId: string,
  userId: string,
  email: string,
  requestId: string,
) => {
  const pendingCheckoutId = createPendingStarterCheckoutId(requestId)
  const currentWorkspace = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`)
    const currentUser = await tx.query.user.findFirst({
      where: eq(user.id, userId),
    })
    if (!currentUser) throw new BillingError("User not found", 404)
    if (
      currentUser.starterGrantedAt ||
      hasActiveStarterCheckoutReservation(currentUser.starterCreemCheckoutId)
    ) {
      throw new BillingError("Starter already used", 409)
    }

    await lockWorkspace(tx, workspaceId)
    const currentWorkspace = await tx.query.workspace.findFirst({
      where: eq(workspace.id, workspaceId),
    })
    if (!currentWorkspace) throw new BillingError("Workspace not found", 404)
    if (isPaidTier(currentWorkspace.billingTier)) {
      throw new BillingError("Workspace already has a billing plan", 409)
    }

    await tx
      .update(user)
      .set({ starterCreemCheckoutId: pendingCheckoutId })
      .where(eq(user.id, userId))

    return currentWorkspace
  })

  let checkout: Awaited<ReturnType<typeof creem.checkouts.create>>
  try {
    checkout = await creem.checkouts.create({
      productId: env.CREEM_STARTER_PRODUCT_ID,
      requestId,
      customer: { email },
      successUrl: new URL(
        `/${encodeURIComponent(currentWorkspace.providerAccountLogin)}/billing/success?workspaceId=${encodeURIComponent(workspaceId)}`,
        env.FRONTEND_URL,
      ).toString(),
      metadata: { referenceId: workspaceId, userId, starterRequestId: requestId },
    })
  } catch (error) {
    throw error
  }

  if (!checkout.checkoutUrl) {
    throw new Error("Creem checkout did not include a redirect URL")
  }

  return { url: checkout.checkoutUrl }
}

export const createWorkspacePortal = async (workspaceId: string) => {
  const currentWorkspace = await getWorkspace(workspaceId)
  if (!currentWorkspace?.creemCustomerId) {
    throw new BillingError("Workspace does not have a Creem customer", 404)
  }
  const portal = await creem.customers.generateBillingLinks({
    customerId: currentWorkspace.creemCustomerId,
  })
  return { url: portal.customerPortalLink }
}

export const cancelWorkspaceSubscription = async (workspaceId: string) => {
  const currentWorkspace = await getWorkspace(workspaceId)
  if (!currentWorkspace?.creemSubscriptionId) {
    throw new BillingError("Workspace does not have an active subscription", 404)
  }
  const subscription = await creem.subscriptions.cancel(
    currentWorkspace.creemSubscriptionId,
    { mode: "scheduled", onExecute: "cancel" },
  )
  await db
    .update(workspace)
    .set({
      billingStatus: "scheduled_cancel",
      billingPeriodEnd: subscription.currentPeriodEndDate
        ? toDate(subscription.currentPeriodEndDate, "subscription period end")
        : currentWorkspace.billingPeriodEnd,
      pendingBillingTier: null,
      updatedAt: new Date(),
    })
    .where(eq(workspace.id, workspaceId))
  return { success: true, message: "Subscription will cancel at period end" }
}

export const changeWorkspacePlan = async (
  workspaceId: string,
  tier: PurchasableBillingTier,
) => {
  const currentWorkspace = await getWorkspace(workspaceId)
  if (!currentWorkspace?.creemSubscriptionId) {
    throw new BillingError("Workspace does not have an active subscription", 404)
  }
  if (currentWorkspace.billingStatus === "scheduled_cancel") {
    throw new BillingError("Resume the subscription before changing plans", 409)
  }
  const planChangeKind = getPlanChangeKind(currentWorkspace.billingTier, tier)
  if (planChangeKind === "same") {
    throw new BillingError("Workspace is already on this billing plan", 409)
  }
  if (planChangeKind === "unsupported") {
    throw new BillingError("Unsupported billing plan change", 409)
  }
  const plan = getPurchasablePlan(tier)
  if (!plan) throw new BillingError("Unknown purchasable billing tier")

  const subscription = await creem.subscriptions.upgrade(
    currentWorkspace.creemSubscriptionId,
    {
      productId: plan.productId,
      updateBehavior:
        planChangeKind === "upgrade"
          ? "proration-charge-immediately"
          : "proration-none",
    },
  )

  if (planChangeKind === "downgrade") {
    await db
      .update(workspace)
      .set({ pendingBillingTier: "premium", updatedAt: new Date() })
      .where(eq(workspace.id, workspaceId))
    return getWorkspaceBilling(workspaceId)
  }

  await db.transaction(async (tx) => {
    await lockWorkspace(tx, workspaceId)
    const productId =
      typeof subscription.product === "string"
        ? subscription.product
        : subscription.product.id
    const customerId =
      typeof subscription.customer === "string"
        ? subscription.customer
        : subscription.customer.id
    if (!subscription.currentPeriodStartDate || !subscription.currentPeriodEndDate) {
      throw new Error("Upgraded subscription did not include a billing period")
    }

    await resetCredits(tx, currentWorkspace, {
      id: subscription.id,
      productId,
      customerId,
      status: subscription.status,
      periodStart: toDate(
        subscription.currentPeriodStartDate,
        "subscription period start",
      ),
      periodEnd: toDate(
        subscription.currentPeriodEndDate,
        "subscription period end",
      ),
    }, "subscription_upgrade")
  })
  return getWorkspaceBilling(workspaceId)
}
