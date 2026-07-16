import { randomUUID } from "node:crypto"
import type {
  NormalizedCheckoutCompletedEvent,
  NormalizedDisputeCreatedEvent,
  NormalizedRefundCreatedEvent,
  NormalizedSubscriptionEntity,
  NormalizedWebhookEvent,
} from "@creem_io/webhook-types"
import { and, count, desc, eq, sql } from "drizzle-orm"
import { db } from "../../db/client"
import {
  pullRequest,
  repository,
  reviewUsage,
  workspace,
  workspaceCharge,
} from "../../db/schema"
import { apiEnv as env } from "../../env"
import { creem } from "./creem"
import {
  getMonthlyAllowance,
  getPlanByProductId,
  getPurchasablePlan,
  isPaidTier,
  publicBillingPlans,
  type PurchasableBillingTier,
} from "./plans"
import { MINIMUM_TOP_UP_CREDITS } from "@workspace/billing/plans"
import {
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

const toDate = (value: Date | string | number, field: string) => {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid Creem ${field}: ${String(value)}`)
  }
  return date
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const metadataString = (
  metadata: Record<string, string | number | null> | undefined,
  key: string
) => {
  const value = metadata?.[key]
  return typeof value === "string" && value.length > 0 ? value : null
}

const numberFromMetadata = (
  metadata: Record<string, string | number | null> | undefined,
  key: string
) => {
  const value = metadata?.[key]
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

const objectId = (value: unknown) => {
  if (typeof value === "string") return value
  if (isRecord(value) && typeof value.id === "string") return value.id
  return null
}

const checkoutOrder = (event: NormalizedCheckoutCompletedEvent) =>
  isRecord(event.object.order) ? event.object.order : null

const checkoutTransactionId = (event: NormalizedCheckoutCompletedEvent) => {
  const order = checkoutOrder(event)
  return objectId(order?.transaction) ?? event.object.id
}

const checkoutAmount = (event: NormalizedCheckoutCompletedEvent) => {
  const order = checkoutOrder(event)
  const amountPaid = order?.amount_paid
  const amount = order?.amount
  return typeof amountPaid === "number"
    ? amountPaid
    : typeof amount === "number"
      ? amount
      : 0
}

const checkoutCurrency = (event: NormalizedCheckoutCompletedEvent) => {
  const order = checkoutOrder(event)
  return typeof order?.currency === "string" ? order.currency : "USD"
}

const checkoutCustomerId = (event: NormalizedCheckoutCompletedEvent) =>
  objectId(event.object.customer)

export class BillingError extends Error {
  constructor(
    message: string,
    public readonly statusCode: 400 | 404 | 409 = 400
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
  creditBalance: value.includedCreditBalance + value.purchasedCreditBalance,
  includedCreditBalance: value.includedCreditBalance,
  purchasedCreditBalance: value.purchasedCreditBalance,
  creemCustomerId: value.creemCustomerId,
  creemSubscriptionId: value.creemSubscriptionId,
})

const resolveWorkspace = async (
  tx: Transaction,
  metadata: Record<string, string | number | null> | undefined,
  subscriptionId: string | null
) => {
  const referenceId = getWorkspaceReferenceId(metadata)
  if (referenceId) {
    return tx.query.workspace.findFirst({
      where: eq(workspace.id, referenceId),
    })
  }

  return subscriptionId
    ? tx.query.workspace.findFirst({
        where: eq(workspace.creemSubscriptionId, subscriptionId),
      })
    : null
}

const recordCharge = async (
  tx: Transaction,
  values: {
    workspaceId: string
    creemTransactionId: string
    type: "payment" | "refund" | "dispute"
    amount: number
    currency: string
    status: string
    credits?: number | null
    description?: string | null
    productId?: string | null
    tier?: string | null
    createdAt: Date
  }
) => {
  const inserted = await tx
    .insert(workspaceCharge)
    .values({
      id: randomUUID(),
      ...values,
      credits: values.credits ?? null,
      description: values.description ?? null,
      productId: values.productId ?? null,
      tier: values.tier ?? null,
    })
    .onConflictDoNothing({ target: workspaceCharge.creemTransactionId })
    .returning({ id: workspaceCharge.id })
  return inserted[0]?.id ?? null
}

const recordFinancialCharge = (
  tx: Transaction,
  event: NormalizedRefundCreatedEvent | NormalizedDisputeCreatedEvent,
  values: {
    workspaceId: string
    description: string
  }
) =>
  event.eventType === "refund.created"
    ? recordCharge(tx, {
        workspaceId: values.workspaceId,
        creemTransactionId: event.object.id,
        type: "refund",
        amount: event.object.refund_amount,
        currency: event.object.refund_currency,
        status: event.object.status,
        description: values.description,
        createdAt: new Date(event.created_at),
      })
    : recordCharge(tx, {
        workspaceId: values.workspaceId,
        creemTransactionId: event.object.id,
        type: "dispute",
        amount: event.object.amount,
        currency: event.object.currency,
        status: "dispute",
        description: values.description,
        createdAt: new Date(event.created_at),
      })

const resetCredits = async (
  tx: Transaction,
  currentWorkspace: typeof workspace.$inferSelect,
  subscription: CreditResetSubscription
) => {
  const plan = getPlanByProductId(subscription.productId)
  if (!plan)
    throw new BillingError(`Unknown Creem product: ${subscription.productId}`)

  // Idempotency: a retried allowance grant for the same subscription period +
  // product must not top up credits twice.
  const resetKey = periodResetKey(
    subscription.id,
    subscription.productId,
    subscription.periodStart
  )
  if (currentWorkspace.lastCreditResetKey === resetKey) return

  await tx
    .update(workspace)
    .set({
      billingTier: plan.slug,
      billingStatus: subscription.status,
      includedCreditBalance: plan.monthlyCredits,
      purchasedCreditBalance: currentWorkspace.purchasedCreditBalance,
      creemCustomerId: subscription.customerId,
      creemSubscriptionId: subscription.id,
      billingPeriodStart: subscription.periodStart,
      billingPeriodEnd: subscription.periodEnd,
      pendingBillingTier: null,
      lastCreditResetKey: resetKey,
      updatedAt: new Date(),
    })
    .where(eq(workspace.id, currentWorkspace.id))
}

const revokeCredits = async (
  tx: Transaction,
  currentWorkspace: typeof workspace.$inferSelect,
  status?: string
) => {
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
      includedCreditBalance: 0,
      purchasedCreditBalance: 0,
      updatedAt: new Date(),
    })
    .where(eq(workspace.id, currentWorkspace.id))
}

const applySubscriptionEvent = async (
  event: Extract<
    NormalizedWebhookEvent,
    { object: NormalizedSubscriptionEntity }
  >
) => {
  await db.transaction(async (tx) => {
    const subscription = event.object
    const currentWorkspace = await resolveWorkspace(
      tx,
      subscription.metadata,
      subscription.id
    )
    if (!currentWorkspace) return

    await lockWorkspace(tx, currentWorkspace.id)
    const lockedWorkspace = await tx.query.workspace.findFirst({
      where: eq(workspace.id, currentWorkspace.id),
    })
    if (!lockedWorkspace) return
    if (
      isStaleCreemEvent(
        lockedWorkspace.creemLastEventAt,
        new Date(event.created_at)
      )
    ) {
      return
    }

    if (event.eventType === "subscription.paid") {
      const periodStart = toDate(
        subscription.current_period_start_date,
        "subscription period start"
      )
      const periodEnd = toDate(
        subscription.current_period_end_date,
        "subscription period end"
      )
      await resetCredits(tx, lockedWorkspace, {
        id: subscription.id,
        productId: subscription.product.id,
        customerId: subscription.customer.id,
        status: subscription.status,
        periodStart,
        periodEnd,
      })

      const paidTransaction = subscription.last_transaction
      if (paidTransaction) {
        const plan = getPlanByProductId(subscription.product.id)
        await recordCharge(tx, {
          workspaceId: lockedWorkspace.id,
          creemTransactionId: paidTransaction.id,
          type: "payment",
          amount: paidTransaction.amount_paid ?? paidTransaction.amount,
          currency: paidTransaction.currency,
          status: paidTransaction.status,
          description: plan ? `${plan.name} plan` : null,
          productId: subscription.product.id,
          tier: plan?.slug ?? null,
          createdAt: new Date(event.created_at),
        })
      }
    } else if (shouldRevokeForSubscriptionStatus(subscription.status)) {
      await revokeCredits(tx, lockedWorkspace, subscription.status)
    } else {
      const plan = getPlanByProductId(subscription.product.id)
      const preservePendingDowngrade =
        lockedWorkspace.billingTier === "ultra" &&
        lockedWorkspace.pendingBillingTier === "premium" &&
        plan?.slug === "premium"
      const periodStart = toDate(
        subscription.current_period_start_date,
        "subscription period start"
      )
      const periodEnd = toDate(
        subscription.current_period_end_date,
        "subscription period end"
      )

      await tx
        .update(workspace)
        .set({
          billingTier: preservePendingDowngrade
            ? lockedWorkspace.billingTier
            : (plan?.slug ?? lockedWorkspace.billingTier),
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

const applyCheckoutCompleted = async (
  event: NormalizedCheckoutCompletedEvent
) => {
  const metadata = event.object.metadata
  if (metadataString(metadata, "kind") === "credit_topup") {
    const workspaceId = metadataString(metadata, "workspaceId")
    const credits = numberFromMetadata(metadata, "credits")
    if (!workspaceId || !credits || credits < MINIMUM_TOP_UP_CREDITS) return

    await db.transaction(async (tx) => {
      await lockWorkspace(tx, workspaceId)
      const currentWorkspace = await tx.query.workspace.findFirst({
        where: eq(workspace.id, workspaceId),
      })
      if (!currentWorkspace) return

      const chargeId = await recordCharge(tx, {
        workspaceId,
        creemTransactionId: checkoutTransactionId(event),
        type: "payment",
        amount: checkoutAmount(event),
        currency: checkoutCurrency(event),
        status: "paid",
        credits,
        description: `${credits} review credits`,
        productId: env.CREEM_CREDIT_TOPUP_PRODUCT_ID ?? null,
        tier: metadataString(metadata, "tierAtPurchase"),
        createdAt: new Date(event.created_at),
      })
      if (!chargeId) return

      const nextPurchasedCreditBalance =
        currentWorkspace.purchasedCreditBalance + credits

      await tx
        .update(workspace)
        .set({
          creemCustomerId:
            checkoutCustomerId(event) ?? currentWorkspace.creemCustomerId,
          purchasedCreditBalance: nextPurchasedCreditBalance,
          updatedAt: new Date(),
        })
        .where(eq(workspace.id, workspaceId))
    })
    return
  }

  const referenceId = getWorkspaceReferenceId(metadata)
  if (!referenceId) return

  const subscriptionId =
    typeof event.object.subscription === "object"
      ? event.object.subscription.id
      : (event.object.subscription ?? null)
  await db
    .update(workspace)
    .set({
      creemCustomerId: checkoutCustomerId(event),
      creemSubscriptionId: subscriptionId,
      updatedAt: new Date(),
    })
    .where(eq(workspace.id, referenceId))
}

const getFinancialSubscriptionId = (
  event: NormalizedRefundCreatedEvent | NormalizedDisputeCreatedEvent
) =>
  typeof event.object.subscription === "string"
    ? event.object.subscription
    : (event.object.subscription?.id ??
      event.object.transaction.subscription ??
      null)

const getFinancialTransactionId = (
  event: NormalizedRefundCreatedEvent | NormalizedDisputeCreatedEvent
) => objectId(event.object.transaction)

const applyFinancialRevoke = async (
  event: NormalizedRefundCreatedEvent | NormalizedDisputeCreatedEvent
) => {
  const subscriptionId = getFinancialSubscriptionId(event)
  if (!subscriptionId) {
    const transactionId = getFinancialTransactionId(event)
    if (!transactionId) return

    await db.transaction(async (tx) => {
      const originalCharge = await tx.query.workspaceCharge.findFirst({
        where: eq(workspaceCharge.creemTransactionId, transactionId),
      })
      if (!originalCharge) return
      await lockWorkspace(tx, originalCharge.workspaceId)
      const currentWorkspace = await tx.query.workspace.findFirst({
        where: eq(workspace.id, originalCharge.workspaceId),
      })
      if (!currentWorkspace) return

      const credits = Math.max(0, originalCharge.credits ?? 0)
      if (credits <= 0) return

      const recorded = await recordFinancialCharge(tx, event, {
        workspaceId: originalCharge.workspaceId,
        description:
          event.eventType === "refund.created"
            ? "Credit purchase refund"
            : "Credit purchase dispute",
      })
      if (!recorded) return

      const nextPurchasedCreditBalance =
        currentWorkspace.purchasedCreditBalance - credits

      await tx
        .update(workspace)
        .set({
          purchasedCreditBalance: nextPurchasedCreditBalance,
          updatedAt: new Date(),
        })
        .where(eq(workspace.id, originalCharge.workspaceId))
    })
    return
  }

  await db.transaction(async (tx) => {
    const currentWorkspace = await resolveWorkspace(
      tx,
      undefined,
      subscriptionId
    )
    if (!currentWorkspace) return
    await lockWorkspace(tx, currentWorkspace.id)
    const lockedWorkspace = await tx.query.workspace.findFirst({
      where: eq(workspace.id, currentWorkspace.id),
    })
    if (!lockedWorkspace) return

    const recorded = await recordFinancialCharge(tx, event, {
      workspaceId: lockedWorkspace.id,
      description: event.eventType === "refund.created" ? "Refund" : "Dispute",
    })

    // Only revoke on the first delivery of this refund/dispute. A redelivered
    // webhook no-ops on the charge insert; revoking again here would wipe
    // credits granted by a renewal that happened in between.
    if (recorded) {
      await revokeCredits(tx, lockedWorkspace)
    }
  })
}

export const applyCreemWebhook = async (event: NormalizedWebhookEvent) => {
  if (event.eventType === "checkout.completed")
    return applyCheckoutCompleted(event)
  if (
    event.eventType === "refund.created" ||
    event.eventType === "dispute.created"
  ) {
    return applyFinancialRevoke(event)
  }
  return applySubscriptionEvent(event)
}

export const getWorkspaceBilling = async (workspaceId: string) => {
  const currentWorkspace = await getWorkspace(workspaceId)
  if (!currentWorkspace) throw new BillingError("Workspace not found", 404)
  return {
    plans: publicBillingPlans,
    account: toBillingAccount(currentWorkspace),
  }
}

export type ReviewUsageFilters = {
  repositoryId?: string
}

export const listWorkspaceReviewUsage = async (
  workspaceId: string,
  page: number,
  pageSize: number,
  filters: ReviewUsageFilters = {}
) => {
  const conditions = [eq(reviewUsage.workspaceId, workspaceId)]
  if (filters.repositoryId) {
    conditions.push(eq(reviewUsage.repositoryId, filters.repositoryId))
  }
  const where = and(...conditions)
  const offset = (page - 1) * pageSize

  const items = await db
    .select({
      id: reviewUsage.id,
      reviewRunId: reviewUsage.reviewRunId,
      creditBalanceAfter: reviewUsage.creditBalanceAfter,
      creditsCharged: reviewUsage.creditsCharged,
      reviewableAdditions: reviewUsage.reviewableAdditions,
      reviewableDeletions: reviewUsage.reviewableDeletions,
      reviewableChangedLines: reviewUsage.reviewableChangedLines,
      createdAt: reviewUsage.createdAt,
      repositoryName: repository.fullName,
      pullRequestNumber: pullRequest.number,
      pullRequestTitle: pullRequest.title,
      pullRequestUrl: pullRequest.htmlUrl,
    })
    .from(reviewUsage)
    .leftJoin(pullRequest, eq(reviewUsage.pullRequestId, pullRequest.id))
    .leftJoin(repository, eq(reviewUsage.repositoryId, repository.id))
    .where(where)
    .orderBy(desc(reviewUsage.createdAt))
    .limit(pageSize)
    .offset(offset)

  const [totalRow] = await db
    .select({ value: count() })
    .from(reviewUsage)
    .where(where)

  return { items, page, pageSize, total: totalRow?.value ?? 0 }
}

export const listWorkspaceCharges = async (
  workspaceId: string,
  page: number,
  pageSize: number
) => {
  const where = eq(workspaceCharge.workspaceId, workspaceId)
  const offset = (page - 1) * pageSize

  const items = await db
    .select({
      id: workspaceCharge.id,
      type: workspaceCharge.type,
      amount: workspaceCharge.amount,
      currency: workspaceCharge.currency,
      status: workspaceCharge.status,
      description: workspaceCharge.description,
      tier: workspaceCharge.tier,
      createdAt: workspaceCharge.createdAt,
    })
    .from(workspaceCharge)
    .where(where)
    .orderBy(desc(workspaceCharge.createdAt))
    .limit(pageSize)
    .offset(offset)

  const [totalRow] = await db
    .select({ value: count() })
    .from(workspaceCharge)
    .where(where)

  return { items, page, pageSize, total: totalRow?.value ?? 0 }
}

export const getWorkspaceUsageTrend = async (workspaceId: string) => {
  const rows = await db
    .select({
      date: sql<string>`to_char(date_trunc('day', ${reviewUsage.createdAt}), 'YYYY-MM-DD')`,
      creditsCharged: sql<number>`sum(${reviewUsage.creditsCharged})::int`,
      reviewCount: sql<number>`count(*)::int`,
    })
    .from(reviewUsage)
    .where(
      sql`${reviewUsage.workspaceId} = ${workspaceId} and ${reviewUsage.createdAt} >= now() - interval '30 days'`
    )
    .groupBy(sql`date_trunc('day', ${reviewUsage.createdAt})`)
    .orderBy(sql`date_trunc('day', ${reviewUsage.createdAt})`)

  return rows.map((row) => ({
    date: row.date,
    creditsCharged: Number(row.creditsCharged),
    reviewCount: Number(row.reviewCount),
  }))
}

export const createWorkspaceCheckout = async (
  workspaceId: string,
  email: string,
  tier: string,
  requestId: string
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
      env.FRONTEND_URL
    ).toString(),
    metadata: { referenceId: workspaceId },
  })
  if (!checkout.checkoutUrl) {
    throw new Error("Creem checkout did not include a redirect URL")
  }
  return { url: checkout.checkoutUrl }
}

export const createWorkspaceCreditCheckout = async (
  workspaceId: string,
  email: string,
  credits: number,
  requestId: string
) => {
  if (!Number.isInteger(credits) || credits < MINIMUM_TOP_UP_CREDITS) {
    throw new BillingError(
      `Credit top-ups must be at least ${MINIMUM_TOP_UP_CREDITS} credits`
    )
  }
  if (!env.CREEM_CREDIT_TOPUP_PRODUCT_ID) {
    throw new BillingError("Credit top-ups are not configured", 409)
  }

  const currentWorkspace = await getWorkspace(workspaceId)
  if (!currentWorkspace) throw new BillingError("Workspace not found", 404)
  if (
    !isPaidTier(currentWorkspace.billingTier) ||
    shouldRevokeForSubscriptionStatus(currentWorkspace.billingStatus)
  ) {
    throw new BillingError("Credit top-ups require an active paid plan", 409)
  }
  const plan = getPurchasablePlan(currentWorkspace.billingTier)
  if (!plan) throw new BillingError("Unknown purchasable billing tier")

  const successUrl = new URL(
    `/${encodeURIComponent(currentWorkspace.providerAccountLogin)}/billing/success?workspaceId=${encodeURIComponent(workspaceId)}`,
    env.FRONTEND_URL
  ).toString()
  const checkoutPriceCents = credits * plan.topUpCreditUnitPriceCents
  const checkout = await creem.checkouts.create({
    productId: env.CREEM_CREDIT_TOPUP_PRODUCT_ID,
    requestId,
    customPrice: checkoutPriceCents,
    customer: currentWorkspace.creemCustomerId
      ? { id: currentWorkspace.creemCustomerId }
      : { email },
    successUrl,
    metadata: {
      kind: "credit_topup",
      workspaceId,
      credits,
      unitPriceCents: plan.topUpCreditUnitPriceCents,
      tierAtPurchase: plan.slug,
    },
  })
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
    throw new BillingError(
      "Workspace does not have an active subscription",
      404
    )
  }
  const subscription = await creem.subscriptions.cancel(
    currentWorkspace.creemSubscriptionId,
    { mode: "scheduled", onExecute: "cancel" }
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
  tier: PurchasableBillingTier
) => {
  const currentWorkspace = await getWorkspace(workspaceId)
  if (!currentWorkspace?.creemSubscriptionId) {
    throw new BillingError(
      "Workspace does not have an active subscription",
      404
    )
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
    }
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
    if (
      !subscription.currentPeriodStartDate ||
      !subscription.currentPeriodEndDate
    ) {
      throw new Error("Upgraded subscription did not include a billing period")
    }

    await resetCredits(tx, currentWorkspace, {
      id: subscription.id,
      productId,
      customerId,
      status: subscription.status,
      periodStart: toDate(
        subscription.currentPeriodStartDate,
        "subscription period start"
      ),
      periodEnd: toDate(
        subscription.currentPeriodEndDate,
        "subscription period end"
      ),
    })
  })
  return getWorkspaceBilling(workspaceId)
}
