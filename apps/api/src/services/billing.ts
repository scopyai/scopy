import { randomUUID } from "node:crypto"
import type {
  FlatCheckoutCompleted,
  FlatDisputeCreated,
  FlatRefundCreated,
  FlatSubscriptionEvent,
} from "@creem_io/better-auth"
import {
  createCheckout,
  createCreemClient,
  createPortal,
} from "@creem_io/better-auth/server"
import { and, desc, eq, gte, sql } from "drizzle-orm"
import { db } from "../db/client"
import {
  creemSubscription,
  workspaceBillingAccount,
  workspaceCreditLedger,
} from "../db/schema"
import { env } from "../env"
import {
  billingPlans,
  getPlanByProductId,
  getPurchasablePlan,
  type PurchasableBillingTier,
} from "../billing/plans"
import {
  calculateResetDelta,
  canConsumeCredits,
  periodGrantKey,
  retainsCreditsDuringCancellation,
  shouldRevokeForSubscriptionStatus,
} from "../billing/policy"

const creemConfig = {
  apiKey: env.CREEM_API_KEY,
  testMode: env.CREEM_TEST_MODE,
}

const creemClient = createCreemClient(creemConfig)

type SubscriptionWebhook = FlatSubscriptionEvent<string>
type LedgerEventType = "grant" | "consume" | "revoke" | "adjustment"

export class BillingError extends Error {
  constructor(
    message: string,
    public readonly statusCode: 400 | 404 | 409 = 400
  ) {
    super(message)
    this.name = "BillingError"
  }
}

const lockWorkspace = async (
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  workspaceId: string
) => {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${workspaceId}))`)
}

const defaultBillingState = (workspaceId: string) => ({
  workspaceId,
  creemCustomerId: null,
  creemSubscriptionId: null,
  productId: null,
  tier: "free" as const,
  status: "free",
  periodStart: null,
  periodEnd: null,
  cancelAtPeriodEnd: false,
  monthlyAllowance: 0,
  creditBalance: 0,
})

const getAccount = async (workspaceId: string) =>
  (await db.query.workspaceBillingAccount.findFirst({
    where: eq(workspaceBillingAccount.workspaceId, workspaceId),
  })) ?? null

const getSubscriptionId = (
  subscription: { id: string } | string | undefined
) => (typeof subscription === "string" ? subscription : subscription?.id)

const getCustomerId = (customer: { id: string } | string | undefined) =>
  typeof customer === "string" ? customer : customer?.id

const getProductId = (product: { id: string } | string) =>
  typeof product === "string" ? product : product.id

const getReferenceId = (metadata?: Record<string, unknown>) => {
  const referenceId = metadata?.referenceId
  return typeof referenceId === "string" ? referenceId : null
}

const toDate = (value: Date | string | number | null | undefined) => {
  if (value === null || value === undefined) return null
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new BillingError(`Invalid Creem date: ${String(value)}`)
  }
  return date
}

const billingLog = (
  level: "info" | "warn" | "error",
  message: string,
  details: Record<string, unknown> = {}
) => {
  console[level](`[billing] ${message}`, details)
}

const resolveWorkspaceId = async (data: {
  metadata?: Record<string, unknown>
  subscriptionId?: string
  customerId?: string
}) => {
  const metadataWorkspaceId = getReferenceId(data.metadata)
  if (metadataWorkspaceId) {
    return metadataWorkspaceId
  }

  const account = data.subscriptionId
    ? await db.query.workspaceBillingAccount.findFirst({
        where: eq(
          workspaceBillingAccount.creemSubscriptionId,
          data.subscriptionId
        ),
      })
    : data.customerId
      ? await db.query.workspaceBillingAccount.findFirst({
          where: eq(workspaceBillingAccount.creemCustomerId, data.customerId),
        })
      : null

  if (account) {
    billingLog(
      "warn",
      "Resolved workspace from local billing account fallback",
      {
        workspaceId: account.workspaceId,
        subscriptionId: data.subscriptionId,
        customerId: data.customerId,
      }
    )
  }

  return account?.workspaceId ?? null
}

const upsertAccountProjection = async (
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  values: {
    workspaceId: string
    creemCustomerId?: string | null
    creemSubscriptionId?: string | null
    productId?: string | null
    tier?: PurchasableBillingTier
    status?: string
    periodStart?: Date | null
    periodEnd?: Date | null
    cancelAtPeriodEnd?: boolean
    monthlyAllowance?: number
  }
) => {
  await tx
    .insert(workspaceBillingAccount)
    .values({
      ...defaultBillingState(values.workspaceId),
      ...values,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: workspaceBillingAccount.workspaceId,
      set: {
        ...values,
        updatedAt: new Date(),
      },
    })
}

const upsertCreemSubscription = async (
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  values: {
    productId: string
    referenceId: string
    creemCustomerId?: string | null
    creemSubscriptionId: string
    status: string
    periodStart?: Date | null
    periodEnd?: Date | null
    cancelAtPeriodEnd?: boolean
  }
) => {
  await tx
    .insert(creemSubscription)
    .values({
      id: randomUUID(),
      ...values,
    })
    .onConflictDoUpdate({
      target: creemSubscription.creemSubscriptionId,
      set: values,
    })
}

const appendLedgerEntry = async (
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  values: {
    workspaceId: string
    eventType: LedgerEventType
    delta: number
    balanceAfter: number
    idempotencyKey: string
    reason: string
    metadata?: Record<string, unknown>
  }
) =>
  tx.insert(workspaceCreditLedger).values({
    id: randomUUID(),
    ...values,
    metadata: values.metadata ?? {},
  })

const resetCreditsForSubscription = async (
  values: {
    workspaceId: string
    subscriptionId: string
    customerId?: string | null
    productId: string
    status: string
    periodStart: Date
    periodEnd?: Date | null
  },
  reason: string
) => {
  billingLog("info", "Resetting workspace credits from subscription", {
    workspaceId: values.workspaceId,
    subscriptionId: values.subscriptionId,
    customerId: values.customerId,
    productId: values.productId,
    status: values.status,
    periodStart: values.periodStart,
    reason,
  })
  const plan = getPlanByProductId(values.productId)
  if (!plan) {
    billingLog("error", "Ignoring subscription with unknown product", {
      workspaceId: values.workspaceId,
      subscriptionId: values.subscriptionId,
      productId: values.productId,
    })
    throw new BillingError(`Unknown Creem product: ${values.productId}`)
  }

  const idempotencyKey = periodGrantKey(
    values.subscriptionId,
    values.productId,
    values.periodStart
  )

  await db.transaction(async (tx) => {
    await lockWorkspace(tx, values.workspaceId)
    const existingLedgerEntry = await tx.query.workspaceCreditLedger.findFirst({
      where: eq(workspaceCreditLedger.idempotencyKey, idempotencyKey),
    })
    if (existingLedgerEntry) {
      billingLog("info", "Skipped duplicate credit grant", {
        workspaceId: values.workspaceId,
        idempotencyKey,
      })
      return
    }

    await upsertAccountProjection(tx, {
      workspaceId: values.workspaceId,
      creemCustomerId: values.customerId,
      creemSubscriptionId: values.subscriptionId,
      productId: values.productId,
      tier: plan.slug,
      status: values.status,
      periodStart: values.periodStart,
      periodEnd: values.periodEnd,
      cancelAtPeriodEnd: false,
      monthlyAllowance: plan.monthlyCredits,
    })
    await upsertCreemSubscription(tx, {
      productId: values.productId,
      referenceId: values.workspaceId,
      creemCustomerId: values.customerId,
      creemSubscriptionId: values.subscriptionId,
      status: values.status,
      periodStart: values.periodStart,
      periodEnd: values.periodEnd,
      cancelAtPeriodEnd: false,
    })

    const account = await tx.query.workspaceBillingAccount.findFirst({
      where: eq(workspaceBillingAccount.workspaceId, values.workspaceId),
    })
    if (!account) throw new Error("Workspace billing account was not created")

    await tx
      .update(workspaceBillingAccount)
      .set({
        creditBalance: plan.monthlyCredits,
        updatedAt: new Date(),
      })
      .where(eq(workspaceBillingAccount.workspaceId, values.workspaceId))

    await appendLedgerEntry(tx, {
      workspaceId: values.workspaceId,
      eventType: "grant",
      delta: calculateResetDelta(account.creditBalance, plan.monthlyCredits),
      balanceAfter: plan.monthlyCredits,
      idempotencyKey,
      reason,
      metadata: {
        subscriptionId: values.subscriptionId,
        productId: values.productId,
        periodStart: values.periodStart.toISOString(),
      },
    })
    billingLog("info", "Workspace credits reset", {
      workspaceId: values.workspaceId,
      tier: plan.slug,
      creditBalance: plan.monthlyCredits,
      idempotencyKey,
    })
  })
}

const revokeCredits = async (
  workspaceId: string,
  subscriptionId: string,
  purpose: string,
  status: string
) => {
  const idempotencyKey = `${subscriptionId}:${purpose}:revoke`
  await db.transaction(async (tx) => {
    await lockWorkspace(tx, workspaceId)
    const existingLedgerEntry = await tx.query.workspaceCreditLedger.findFirst({
      where: eq(workspaceCreditLedger.idempotencyKey, idempotencyKey),
    })
    if (existingLedgerEntry) return

    const account = await tx.query.workspaceBillingAccount.findFirst({
      where: eq(workspaceBillingAccount.workspaceId, workspaceId),
    })
    if (!account) return

    await tx
      .update(workspaceBillingAccount)
      .set({
        status,
        creditBalance: 0,
        updatedAt: new Date(),
      })
      .where(eq(workspaceBillingAccount.workspaceId, workspaceId))

    await appendLedgerEntry(tx, {
      workspaceId,
      eventType: "revoke",
      delta: -account.creditBalance,
      balanceAfter: 0,
      idempotencyKey,
      reason: purpose,
      metadata: { subscriptionId },
    })
  })
}

const updateSubscriptionProjection = async (
  data: SubscriptionWebhook,
  overrides: { cancelAtPeriodEnd?: boolean } = {}
) => {
  const customerId = getCustomerId(data.customer)
  const workspaceId = await resolveWorkspaceId({
    metadata: data.metadata,
    subscriptionId: data.id,
    customerId,
  })
  if (!workspaceId) {
    billingLog("warn", "Could not resolve workspace for subscription event", {
      eventType: data.webhookEventType,
      subscriptionId: data.id,
      customerId,
      productId: getProductId(data.product),
      hasMetadata: Boolean(data.metadata),
    })
    return
  }

  const productId = getProductId(data.product)
  const plan = getPlanByProductId(productId)
  const periodStart = toDate(data.current_period_start_date)
  const periodEnd = toDate(data.current_period_end_date)
  billingLog("info", "Updating workspace subscription projection", {
    eventType: data.webhookEventType,
    workspaceId,
    subscriptionId: data.id,
    customerId,
    productId,
    tier: plan?.slug,
    status: data.status,
  })
  await db.transaction(async (tx) => {
    await lockWorkspace(tx, workspaceId)
    await upsertAccountProjection(tx, {
      workspaceId,
      creemCustomerId: customerId,
      creemSubscriptionId: data.id,
      productId,
      tier: plan?.slug,
      status: data.status,
      periodStart,
      periodEnd,
      ...overrides,
    })
    await upsertCreemSubscription(tx, {
      productId,
      referenceId: workspaceId,
      creemCustomerId: customerId,
      creemSubscriptionId: data.id,
      status: data.status,
      periodStart,
      periodEnd,
      ...overrides,
    })
  })
}

export const getWorkspaceBilling = async (workspaceId: string) => ({
  plans: billingPlans,
  account: (await getAccount(workspaceId)) ?? defaultBillingState(workspaceId),
})

export const listWorkspaceCreditLedger = async (
  workspaceId: string,
  page: number,
  pageSize: number
) => {
  const offset = (page - 1) * pageSize
  const [items, [{ count }]] = await Promise.all([
    db.query.workspaceCreditLedger.findMany({
      where: eq(workspaceCreditLedger.workspaceId, workspaceId),
      orderBy: [desc(workspaceCreditLedger.createdAt)],
      limit: pageSize,
      offset,
    }),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(workspaceCreditLedger)
      .where(eq(workspaceCreditLedger.workspaceId, workspaceId)),
  ])

  return { items, page, pageSize, total: count }
}

export const createWorkspaceCheckout = async (
  workspaceId: string,
  email: string,
  tier: string,
  requestId: string
) => {
  const plan = getPurchasablePlan(tier)
  if (!plan) throw new BillingError("Unknown purchasable billing tier")

  const account = await getAccount(workspaceId)
  if (account && account.tier !== "free") {
    throw new BillingError("Workspace already has a billing plan", 409)
  }

  billingLog("info", "Creating workspace checkout", {
    workspaceId,
    tier: plan.slug,
    productId: plan.productId,
    requestId,
  })
  return createCheckout(creemConfig, {
    productId: plan.productId,
    requestId,
    customer: { email },
    successUrl: new URL(
      `/billing/success?workspaceId=${encodeURIComponent(workspaceId)}`,
      env.FRONTEND_URL
    ).toString(),
    metadata: { referenceId: workspaceId, workspaceId, tier: plan.slug },
    skipTrial: true,
  })
}

export const createWorkspacePortal = async (workspaceId: string) => {
  const account = await getAccount(workspaceId)
  if (!account?.creemCustomerId) {
    throw new BillingError("Workspace does not have a Creem customer", 404)
  }

  return createPortal(creemConfig, account.creemCustomerId)
}

export const cancelWorkspaceSubscription = async (workspaceId: string) => {
  const account = await getAccount(workspaceId)
  if (!account?.creemSubscriptionId) {
    throw new BillingError(
      "Workspace does not have an active subscription",
      404
    )
  }

  await creemClient.subscriptions.cancel(account.creemSubscriptionId, {
    mode: "scheduled",
    onExecute: "cancel",
  })
  await db
    .update(workspaceBillingAccount)
    .set({ cancelAtPeriodEnd: true, updatedAt: new Date() })
    .where(eq(workspaceBillingAccount.workspaceId, workspaceId))
  await db
    .update(creemSubscription)
    .set({ cancelAtPeriodEnd: true })
    .where(
      eq(creemSubscription.creemSubscriptionId, account.creemSubscriptionId)
    )

  return { success: true, message: "Subscription will cancel at period end" }
}

export const upgradeWorkspaceSubscription = async (workspaceId: string) => {
  const account = await getAccount(workspaceId)
  if (!account?.creemSubscriptionId || account.tier !== "premium") {
    throw new BillingError("Only Premium workspaces can upgrade to Ultra", 409)
  }

  const ultra = getPurchasablePlan("ultra")
  if (!ultra) throw new Error("Ultra billing plan is not configured")

  const subscription = await creemClient.subscriptions.upgrade(
    account.creemSubscriptionId,
    {
      productId: ultra.productId,
      updateBehavior: "proration-charge-immediately",
    }
  )

  if (!subscription.currentPeriodStartDate) {
    throw new Error("Upgraded subscription did not include a billing period")
  }

  await resetCreditsForSubscription(
    {
      workspaceId,
      subscriptionId: subscription.id,
      customerId: getCustomerId(subscription.customer),
      productId: ultra.productId,
      status: subscription.status,
      periodStart: subscription.currentPeriodStartDate,
      periodEnd: subscription.currentPeriodEndDate,
    },
    "subscription_upgrade"
  )

  return getWorkspaceBilling(workspaceId)
}

export const consumeWorkspaceCredits = async (input: {
  workspaceId: string
  amount: number
  idempotencyKey: string
  reason: string
  metadata?: Record<string, unknown>
}) => {
  if (!canConsumeCredits(Number.MAX_SAFE_INTEGER, input.amount)) {
    throw new BillingError("Credit amount must be a positive integer")
  }

  return db.transaction(async (tx) => {
    await lockWorkspace(tx, input.workspaceId)
    const existingLedgerEntry = await tx.query.workspaceCreditLedger.findFirst({
      where: eq(workspaceCreditLedger.idempotencyKey, input.idempotencyKey),
    })
    if (existingLedgerEntry) return existingLedgerEntry

    const [account] = await tx
      .update(workspaceBillingAccount)
      .set({
        creditBalance: sql`${workspaceBillingAccount.creditBalance} - ${input.amount}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(workspaceBillingAccount.workspaceId, input.workspaceId),
          gte(workspaceBillingAccount.creditBalance, input.amount)
        )
      )
      .returning()

    if (!account) {
      throw new BillingError("Insufficient workspace credits", 409)
    }

    const [ledgerEntry] = await tx
      .insert(workspaceCreditLedger)
      .values({
        id: randomUUID(),
        workspaceId: input.workspaceId,
        eventType: "consume",
        delta: -input.amount,
        balanceAfter: account.creditBalance,
        idempotencyKey: input.idempotencyKey,
        reason: input.reason,
        metadata: input.metadata ?? {},
      })
      .returning()

    return ledgerEntry
  })
}

export const handleCheckoutCompleted = async (data: FlatCheckoutCompleted) => {
  const workspaceId = getReferenceId(data.metadata)
  const subscriptionId = getSubscriptionId(data.subscription)
  const customerId = getCustomerId(data.customer)
  const productId = getProductId(data.product)
  billingLog("info", "Received checkout.completed", {
    webhookId: data.webhookId,
    workspaceId,
    subscriptionId,
    customerId,
    productId,
    status: data.status,
    hasMetadata: Boolean(data.metadata),
  })
  if (!workspaceId) {
    billingLog(
      "warn",
      "Ignoring checkout.completed without workspace reference",
      {
        webhookId: data.webhookId,
        subscriptionId,
        customerId,
      }
    )
    return
  }

  await db.transaction(async (tx) => {
    await lockWorkspace(tx, workspaceId)
    await upsertAccountProjection(tx, {
      workspaceId,
      creemCustomerId: customerId,
      creemSubscriptionId: subscriptionId,
      productId,
      status:
        typeof data.subscription === "object"
          ? data.subscription.status
          : data.status,
    })
    if (subscriptionId) {
      await upsertCreemSubscription(tx, {
        productId,
        referenceId: workspaceId,
        creemCustomerId: customerId,
        creemSubscriptionId: subscriptionId,
        status:
          typeof data.subscription === "object"
            ? data.subscription.status
            : data.status,
        periodStart: toDate(
          typeof data.subscription === "object"
            ? data.subscription.current_period_start_date
            : null
        ),
        periodEnd: toDate(
          typeof data.subscription === "object"
            ? data.subscription.current_period_end_date
            : null
        ),
      })
    }
  })
}

export const handleSubscriptionPaid = async (
  data: FlatSubscriptionEvent<"subscription.paid">
) => {
  const customerId = getCustomerId(data.customer)
  const workspaceId = await resolveWorkspaceId({
    metadata: data.metadata,
    subscriptionId: data.id,
    customerId,
  })
  billingLog("info", "Received subscription.paid", {
    webhookId: data.webhookId,
    workspaceId,
    subscriptionId: data.id,
    customerId,
    productId: getProductId(data.product),
    status: data.status,
    hasMetadata: Boolean(data.metadata),
  })
  if (!workspaceId) {
    billingLog("warn", "Ignoring subscription.paid without workspace mapping", {
      webhookId: data.webhookId,
      subscriptionId: data.id,
      customerId,
    })
    return
  }

  await resetCreditsForSubscription(
    {
      workspaceId,
      subscriptionId: data.id,
      customerId,
      productId: getProductId(data.product),
      status: data.status,
      periodStart:
        toDate(data.current_period_start_date) ??
        (() => {
          throw new BillingError(
            "Paid subscription did not include period start"
          )
        })(),
      periodEnd: toDate(data.current_period_end_date),
    },
    "subscription_paid"
  )
}

export const handleSubscriptionStatus = async (data: SubscriptionWebhook) => {
  const customerId = getCustomerId(data.customer)
  const workspaceId = await resolveWorkspaceId({
    metadata: data.metadata,
    subscriptionId: data.id,
    customerId,
  })
  billingLog("info", "Received subscription status event", {
    eventType: data.webhookEventType,
    webhookId: data.webhookId,
    workspaceId,
    subscriptionId: data.id,
    customerId,
    productId: getProductId(data.product),
    status: data.status,
    hasMetadata: Boolean(data.metadata),
  })
  if (!workspaceId) return

  await updateSubscriptionProjection(data)
  if (shouldRevokeForSubscriptionStatus(data.status)) {
    await revokeCredits(
      workspaceId,
      data.id,
      `subscription_${data.status}`,
      data.status
    )
  }
}

export const handleSubscriptionCanceled = async (
  data: FlatSubscriptionEvent<"subscription.canceled">
) => {
  const customerId = getCustomerId(data.customer)
  const workspaceId = await resolveWorkspaceId({
    metadata: data.metadata,
    subscriptionId: data.id,
    customerId,
  })
  billingLog("info", "Received subscription.canceled", {
    webhookId: data.webhookId,
    workspaceId,
    subscriptionId: data.id,
    customerId,
    status: data.status,
    hasMetadata: Boolean(data.metadata),
  })
  if (!workspaceId) return

  const retainsCurrentPeriod = retainsCreditsDuringCancellation(
    toDate(data.current_period_end_date) ??
      (() => {
        throw new BillingError(
          "Canceled subscription did not include period end"
        )
      })()
  )
  await updateSubscriptionProjection(data, {
    cancelAtPeriodEnd: retainsCurrentPeriod,
  })
  if (!retainsCurrentPeriod) {
    await revokeCredits(
      workspaceId,
      data.id,
      "subscription_canceled",
      "canceled"
    )
  }
}

const revokeFromFinancialEvent = async (
  data: FlatRefundCreated | FlatDisputeCreated
) => {
  const subscriptionId = getSubscriptionId(data.subscription)
  billingLog("info", `Received ${data.webhookEventType}`, {
    webhookId: data.webhookId,
    subscriptionId,
    customerId: getCustomerId(data.customer),
  })
  if (!subscriptionId) return

  const account = await db.query.workspaceBillingAccount.findFirst({
    where: eq(workspaceBillingAccount.creemSubscriptionId, subscriptionId),
  })
  if (!account) return

  await revokeCredits(
    account.workspaceId,
    subscriptionId,
    data.webhookEventType.replace(".", "_"),
    data.webhookEventType
  )
}

export const handleRefundCreated = revokeFromFinancialEvent
export const handleDisputeCreated = revokeFromFinancialEvent
