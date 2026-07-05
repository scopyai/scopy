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

const recordCharge = async (
  tx: Transaction,
  values: {
    workspaceId: string
    creemTransactionId: string
    type: "payment" | "refund" | "dispute"
    amount: number
    currency: string
    status: string
    description?: string | null
    productId?: string | null
    tier?: string | null
    createdAt: Date
  },
) => {
  await tx
    .insert(workspaceCharge)
    .values({
      id: randomUUID(),
      ...values,
      description: values.description ?? null,
      productId: values.productId ?? null,
      tier: values.tier ?? null,
    })
    .onConflictDoNothing({ target: workspaceCharge.creemTransactionId })
}

const resetCredits = async (
  tx: Transaction,
  currentWorkspace: typeof workspace.$inferSelect,
  subscription: CreditResetSubscription,
) => {
  const plan = getPlanByProductId(subscription.productId)
  if (!plan) throw new BillingError(`Unknown Creem product: ${subscription.productId}`)

  // Idempotency: a retried allowance grant for the same subscription period +
  // product must not top up credits twice.
  const resetKey = periodResetKey(
    subscription.id,
    subscription.productId,
    subscription.periodStart,
  )
  if (currentWorkspace.lastCreditResetKey === resetKey) return

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
      lastCreditResetKey: resetKey,
      updatedAt: new Date(),
    })
    .where(eq(workspace.id, currentWorkspace.id))
}

// Setting the balance to 0 is naturally idempotent, so no ledger guard is needed.
const revokeCredits = async (
  tx: Transaction,
  currentWorkspace: typeof workspace.$inferSelect,
  status?: string,
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
      creditBalance: 0,
      updatedAt: new Date(),
    })
    .where(eq(workspace.id, currentWorkspace.id))
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

const applyCheckoutCompleted = async (event: NormalizedCheckoutCompletedEvent) => {
  const referenceId = getWorkspaceReferenceId(event.object.metadata)
  if (!referenceId) return

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
    await revokeCredits(tx, lockedWorkspace)

    if (event.eventType === "refund.created") {
      await recordCharge(tx, {
        workspaceId: lockedWorkspace.id,
        creemTransactionId: event.object.id,
        type: "refund",
        amount: event.object.refund_amount,
        currency: event.object.refund_currency,
        status: event.object.status,
        description: "Refund",
        createdAt: new Date(event.created_at),
      })
    } else {
      await recordCharge(tx, {
        workspaceId: lockedWorkspace.id,
        creemTransactionId: event.object.id,
        type: "dispute",
        amount: event.object.amount,
        currency: event.object.currency,
        status: "dispute",
        description: "Dispute",
        createdAt: new Date(event.created_at),
      })
    }
  })
}

export const applyCreemWebhook = async (event: NormalizedWebhookEvent) => {
  if (event.eventType === "checkout.completed") return applyCheckoutCompleted(event)
  if (event.eventType === "refund.created" || event.eventType === "dispute.created") {
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
  filters: ReviewUsageFilters = {},
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
      balanceAfter: reviewUsage.balanceAfter,
      modelId: reviewUsage.modelId,
      verifierModelId: reviewUsage.verifierModelId,
      llmCostMicrocents: reviewUsage.llmCostMicrocents,
      vectorWriteCostMicrocents: reviewUsage.vectorWriteCostMicrocents,
      vectorQueryCostMicrocents: reviewUsage.vectorQueryCostMicrocents,
      vectorNetworkCostMicrocents: reviewUsage.vectorNetworkCostMicrocents,
      totalCostMicrocents: reviewUsage.totalCostMicrocents,
      vectorWriteBytes: reviewUsage.vectorWriteBytes,
      vectorQueryBytes: reviewUsage.vectorQueryBytes,
      vectorNetworkBytes: reviewUsage.vectorNetworkBytes,
      vectorQueryCount: reviewUsage.vectorQueryCount,
      models: reviewUsage.models,
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
  pageSize: number,
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
      totalCostMicrocents: sql<number>`sum(${reviewUsage.totalCostMicrocents})::bigint`,
      reviewCount: sql<number>`count(*)::int`,
    })
    .from(reviewUsage)
    .where(
      sql`${reviewUsage.workspaceId} = ${workspaceId} and ${reviewUsage.createdAt} >= now() - interval '30 days'`,
    )
    .groupBy(sql`date_trunc('day', ${reviewUsage.createdAt})`)
    .orderBy(sql`date_trunc('day', ${reviewUsage.createdAt})`)

  return rows.map((row) => ({
    date: row.date,
    totalCostMicrocents: Number(row.totalCostMicrocents),
    reviewCount: Number(row.reviewCount),
  }))
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
    })
  })
  return getWorkspaceBilling(workspaceId)
}
