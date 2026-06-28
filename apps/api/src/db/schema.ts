import { relations } from "drizzle-orm"
import {
  boolean,
  bigint,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core"

export const workspaceProvider = pgEnum("workspace_provider", ["github"])
export const providerAccountType = pgEnum("provider_account_type", [
  "user",
  "organization",
])
export const repositorySelection = pgEnum("repository_selection", [
  "all",
  "selected",
])
export const workspaceConnectionStatus = pgEnum("workspace_connection_status", [
  "active",
  "suspended",
  "deleted",
])
export const workspaceMemberRole = pgEnum("workspace_member_role", [
  "owner",
  "admin",
  "member",
])
export const workspaceMemberStatus = pgEnum("workspace_member_status", [
  "active",
  "pending",
])
export const pullRequestState = pgEnum("pull_request_state", [
  "open",
  "closed",
  "merged",
])
export const pullRequestTimelineEventType = pgEnum(
  "pull_request_timeline_event_type",
  ["lifecycle", "issue_comment", "review", "review_comment"]
)
export const reviewRunStatus = pgEnum("review_run_status", [
  "queued",
  "running",
  "completed",
  "skipped",
  "failed",
  "superseded",
])
export const reviewFindingSeverity = pgEnum("review_finding_severity", [
  "critical",
  "high",
  "medium",
  "low",
])
export const workspaceBillingTier = pgEnum("workspace_billing_tier", [
  "free",
  "premium",
  "ultra",
  "enterprise",
])
export const workspaceCreditTransactionType = pgEnum(
  "workspace_credit_transaction_type",
  ["reset", "revoke", "usage_debit", "starter_grant"]
)
export const userOnboardingStatus = pgEnum("user_onboarding_status", [
  "connect_github",
  "select_repositories",
  "done",
])

export type ProviderActor = {
  id: string
  login: string
  avatarUrl: string | null
  htmlUrl: string | null
}

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  onboardingStatus: userOnboardingStatus("onboarding_status")
    .default("connect_github")
    .notNull(),
  // Set the first time the user buys the one-time $1 starter. Its presence is
  // the per-user guard that prevents buying the starter more than once.
  starterGrantedAt: timestamp("starter_granted_at"),
  starterCreemCheckoutId: text("starter_creem_checkout_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
})

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_userId_idx").on(table.userId)]
)

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)]
)

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)]
)

export const workspace = pgTable(
  "workspace",
  {
    id: text("id").primaryKey(),
    provider: workspaceProvider("provider").notNull(),
    providerInstallationId: text("provider_installation_id").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    providerAccountLogin: text("provider_account_login").notNull(),
    providerAccountType: providerAccountType("provider_account_type").notNull(),
    providerAccountAvatarUrl: text("provider_account_avatar_url"),
    name: text("name").notNull(),
    repositorySelection: repositorySelection("repository_selection").notNull(),
    permissions: jsonb("permissions").$type<Record<string, string>>().notNull(),
    connectionStatus: workspaceConnectionStatus("connection_status")
      .default("active")
      .notNull(),
    reviewDrafts: boolean("review_drafts").default(false).notNull(),
    baseBranchPatterns: jsonb("base_branch_patterns")
      .$type<string[]>()
      .default(["main", "master"])
      .notNull(),
    pathIncludePatterns: jsonb("path_include_patterns")
      .$type<string[]>()
      .default([])
      .notNull(),
    pathExcludePatterns: jsonb("path_exclude_patterns")
      .$type<string[]>()
      .default([])
      .notNull(),
    naturalLanguageRules: jsonb("natural_language_rules")
      .$type<string[]>()
      .default([])
      .notNull(),
    maxReviewChangedLines: integer("max_review_changed_lines").notNull(),
    installedByUserId: text("installed_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    installedAt: timestamp("installed_at").defaultNow().notNull(),
    lastSyncedAt: timestamp("last_synced_at"),
    billingTier: workspaceBillingTier("billing_tier").default("free").notNull(),
    billingStatus: text("billing_status").default("free").notNull(),
    creditBalance: bigint("credit_balance", { mode: "number" })
      .default(0)
      .notNull(),
    creemCustomerId: text("creem_customer_id"),
    creemSubscriptionId: text("creem_subscription_id"),
    billingPeriodStart: timestamp("billing_period_start"),
    billingPeriodEnd: timestamp("billing_period_end"),
    pendingBillingTier: workspaceBillingTier("pending_billing_tier"),
    creemLastEventAt: timestamp("creem_last_event_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("workspace_provider_installation_idx").on(
      table.provider,
      table.providerInstallationId
    ),
    uniqueIndex("workspace_provider_account_idx").on(
      table.provider,
      table.providerAccountId
    ),
    index("workspace_installed_by_user_id_idx").on(table.installedByUserId),
    uniqueIndex("workspace_creem_subscription_id_idx").on(
      table.creemSubscriptionId
    ),
  ]
)

export const workspaceMember = pgTable(
  "workspace_member",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: workspaceMemberRole("role").default("member").notNull(),
    status: workspaceMemberStatus("status").default("active").notNull(),
    invitedByUserId: text("invited_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    invitedAt: timestamp("invited_at"),
    acceptedAt: timestamp("accepted_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("workspace_member_workspace_user_idx").on(
      table.workspaceId,
      table.userId
    ),
    index("workspace_member_user_id_idx").on(table.userId),
  ]
)

export const repository = pgTable(
  "repository",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    providerRepositoryId: text("provider_repository_id").notNull(),
    name: text("name").notNull(),
    fullName: text("full_name").notNull(),
    owner: text("owner").notNull(),
    private: boolean("private").notNull(),
    defaultBranch: text("default_branch"),
    htmlUrl: text("html_url").notNull(),
    enabled: boolean("enabled").default(false).notNull(),
    reviewDrafts: boolean("review_drafts"),
    baseBranchPatterns: jsonb("base_branch_patterns").$type<string[]>(),
    pathIncludePatterns: jsonb("path_include_patterns").$type<string[]>(),
    pathExcludePatterns: jsonb("path_exclude_patterns").$type<string[]>(),
    naturalLanguageRules: jsonb("natural_language_rules").$type<string[]>(),
    maxReviewChangedLines: integer("max_review_changed_lines"),
    archived: boolean("archived").default(false).notNull(),
    providerAccessRemovedAt: timestamp("provider_access_removed_at"),
    lastSyncedAt: timestamp("last_synced_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("repository_workspace_provider_id_idx").on(
      table.workspaceId,
      table.providerRepositoryId
    ),
    index("repository_workspace_id_idx").on(table.workspaceId),
  ]
)

export const pullRequest = pgTable(
  "pull_request",
  {
    id: text("id").primaryKey(),
    repositoryId: text("repository_id")
      .notNull()
      .references(() => repository.id, { onDelete: "cascade" }),
    providerPullRequestId: text("provider_pull_request_id").notNull(),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    htmlUrl: text("html_url").notNull(),
    author: jsonb("author").$type<ProviderActor | null>(),
    state: pullRequestState("state").notNull(),
    draft: boolean("draft").default(false).notNull(),
    baseRef: text("base_ref").notNull(),
    headRef: text("head_ref").notNull(),
    headSha: text("head_sha").notNull(),
    labels: jsonb("labels").$type<string[]>().default([]).notNull(),
    assignees: jsonb("assignees")
      .$type<ProviderActor[]>()
      .default([])
      .notNull(),
    openedAt: timestamp("opened_at").notNull(),
    closedAt: timestamp("closed_at"),
    mergedAt: timestamp("merged_at"),
    providerCreatedAt: timestamp("provider_created_at").notNull(),
    providerUpdatedAt: timestamp("provider_updated_at").notNull(),
    lastSyncedAt: timestamp("last_synced_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("pull_request_repository_provider_id_idx").on(
      table.repositoryId,
      table.providerPullRequestId
    ),
    uniqueIndex("pull_request_repository_number_idx").on(
      table.repositoryId,
      table.number
    ),
    index("pull_request_repository_id_idx").on(table.repositoryId),
  ]
)

export const pullRequestTimelineEvent = pgTable(
  "pull_request_timeline_event",
  {
    id: text("id").primaryKey(),
    pullRequestId: text("pull_request_id")
      .notNull()
      .references(() => pullRequest.id, { onDelete: "cascade" }),
    eventType: pullRequestTimelineEventType("event_type").notNull(),
    externalKey: text("external_key").notNull(),
    action: text("action"),
    author: jsonb("author").$type<ProviderActor | null>(),
    body: text("body"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    htmlUrl: text("html_url"),
    providerCreatedAt: timestamp("provider_created_at").notNull(),
    providerUpdatedAt: timestamp("provider_updated_at").notNull(),
    deletedAt: timestamp("deleted_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("pull_request_timeline_external_key_idx").on(
      table.pullRequestId,
      table.externalKey
    ),
    index("pull_request_timeline_pull_request_id_idx").on(table.pullRequestId),
  ]
)

export const repositoryContext = pgTable(
  "repository_context",
  {
    id: text("id").primaryKey(),
    repositoryId: text("repository_id")
      .notNull()
      .references(() => repository.id, { onDelete: "cascade" }),
    baseSha: text("base_sha").notNull(),
    modelId: text("model_id").notNull(),
    markdown: text("markdown").notNull(),
    summary: text("summary").notNull(),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    generatedAt: timestamp("generated_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("repository_context_repository_id_idx").on(table.repositoryId),
    index("repository_context_base_sha_idx").on(table.baseSha),
  ]
)

export const reviewRun = pgTable(
  "review_run",
  {
    id: text("id").primaryKey(),
    pullRequestId: text("pull_request_id")
      .notNull()
      .references(() => pullRequest.id, { onDelete: "cascade" }),
    triggerWebhookEventId: text("trigger_webhook_event_id").references(
      () => webhookEvent.id,
      { onDelete: "set null" }
    ),
    headSha: text("head_sha").notNull(),
    providerCheckRunId: text("provider_check_run_id"),
    checkSyncError: text("check_sync_error"),
    status: reviewRunStatus("status").default("queued").notNull(),
    result: jsonb("result").$type<Record<string, unknown>>(),
    error: text("error"),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("review_run_pull_request_head_sha_idx").on(
      table.pullRequestId,
      table.headSha
    ),
    index("review_run_pull_request_id_idx").on(table.pullRequestId),
    index("review_run_trigger_webhook_event_id_idx").on(
      table.triggerWebhookEventId
    ),
  ]
)

export const reviewFinding = pgTable(
  "review_finding",
  {
    id: text("id").primaryKey(),
    reviewRunId: text("review_run_id")
      .notNull()
      .references(() => reviewRun.id, { onDelete: "cascade" }),
    severity: reviewFindingSeverity("severity").notNull(),
    file: text("file").notNull(),
    startLine: integer("start_line").notNull(),
    endLine: integer("end_line").notNull(),
    title: text("title").notNull(),
    confidence: real("confidence").notNull(),
    language: text("language").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("review_finding_review_run_id_idx").on(table.reviewRunId),
    index("review_finding_severity_idx").on(table.severity),
    index("review_finding_file_idx").on(table.file),
    index("review_finding_language_idx").on(table.language),
  ]
)

export const webhookEvent = pgTable(
  "webhook_event",
  {
    id: text("id").primaryKey(),
    provider: workspaceProvider("provider").notNull(),
    deliveryId: text("delivery_id").notNull(),
    eventName: text("event_name").notNull(),
    action: text("action"),
    workspaceId: text("workspace_id").references(() => workspace.id, {
      onDelete: "set null",
    }),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    receivedAt: timestamp("received_at").defaultNow().notNull(),
    processingStartedAt: timestamp("processing_started_at"),
    processedAt: timestamp("processed_at"),
    processingError: text("processing_error"),
  },
  (table) => [
    uniqueIndex("webhook_event_provider_delivery_idx").on(
      table.provider,
      table.deliveryId
    ),
    index("webhook_event_workspace_id_idx").on(table.workspaceId),
  ]
)

export const workspaceCreditTransaction = pgTable(
  "workspace_credit_transaction",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    type: workspaceCreditTransactionType("type").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    balanceAfter: bigint("balance_after", { mode: "number" }).notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    reason: text("reason").notNull(),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .default({})
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("workspace_credit_transaction_idempotency_key_idx").on(
      table.idempotencyKey
    ),
    index("workspace_credit_transaction_workspace_created_at_idx").on(
      table.workspaceId,
      table.createdAt
    ),
  ]
)

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  installedWorkspaces: many(workspace),
  workspaceMemberships: many(workspaceMember),
}))

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}))

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}))

export const workspaceRelations = relations(workspace, ({ one, many }) => ({
  installedByUser: one(user, {
    fields: [workspace.installedByUserId],
    references: [user.id],
  }),
  members: many(workspaceMember),
  repositories: many(repository),
  webhookEvents: many(webhookEvent),
  creditTransactions: many(workspaceCreditTransaction),
}))

export const workspaceMemberRelations = relations(
  workspaceMember,
  ({ one }) => ({
    workspace: one(workspace, {
      fields: [workspaceMember.workspaceId],
      references: [workspace.id],
    }),
    user: one(user, {
      fields: [workspaceMember.userId],
      references: [user.id],
    }),
    invitedByUser: one(user, {
      fields: [workspaceMember.invitedByUserId],
      references: [user.id],
    }),
  })
)

export const repositoryRelations = relations(repository, ({ one, many }) => ({
  workspace: one(workspace, {
    fields: [repository.workspaceId],
    references: [workspace.id],
  }),
  context: one(repositoryContext),
  pullRequests: many(pullRequest),
}))

export const pullRequestRelations = relations(pullRequest, ({ one, many }) => ({
  repository: one(repository, {
    fields: [pullRequest.repositoryId],
    references: [repository.id],
  }),
  timelineEvents: many(pullRequestTimelineEvent),
  reviewRuns: many(reviewRun),
}))

export const pullRequestTimelineEventRelations = relations(
  pullRequestTimelineEvent,
  ({ one }) => ({
    pullRequest: one(pullRequest, {
      fields: [pullRequestTimelineEvent.pullRequestId],
      references: [pullRequest.id],
    }),
  })
)

export const repositoryContextRelations = relations(
  repositoryContext,
  ({ one }) => ({
    repository: one(repository, {
      fields: [repositoryContext.repositoryId],
      references: [repository.id],
    }),
  })
)

export const reviewRunRelations = relations(reviewRun, ({ one, many }) => ({
  pullRequest: one(pullRequest, {
    fields: [reviewRun.pullRequestId],
    references: [pullRequest.id],
  }),
  triggerWebhookEvent: one(webhookEvent, {
    fields: [reviewRun.triggerWebhookEventId],
    references: [webhookEvent.id],
  }),
  findings: many(reviewFinding),
}))

export const reviewFindingRelations = relations(reviewFinding, ({ one }) => ({
  reviewRun: one(reviewRun, {
    fields: [reviewFinding.reviewRunId],
    references: [reviewRun.id],
  }),
}))

export const webhookEventRelations = relations(
  webhookEvent,
  ({ one, many }) => ({
    workspace: one(workspace, {
      fields: [webhookEvent.workspaceId],
      references: [workspace.id],
    }),
    reviewRuns: many(reviewRun),
  })
)

export const workspaceCreditTransactionRelations = relations(
  workspaceCreditTransaction,
  ({ one }) => ({
    workspace: one(workspace, {
      fields: [workspaceCreditTransaction.workspaceId],
      references: [workspace.id],
    }),
  })
)
