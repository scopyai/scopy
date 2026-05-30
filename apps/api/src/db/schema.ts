import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const workspaceProvider = pgEnum("workspace_provider", ["github"]);
export const providerAccountType = pgEnum("provider_account_type", [
  "user",
  "organization",
]);
export const repositorySelection = pgEnum("repository_selection", [
  "all",
  "selected",
]);
export const workspaceConnectionStatus = pgEnum("workspace_connection_status", [
  "active",
  "suspended",
  "deleted",
]);
export const workspaceMemberRole = pgEnum("workspace_member_role", [
  "owner",
  "admin",
  "member",
]);

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
});

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
  (table) => [index("session_userId_idx").on(table.userId)],
);

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
  (table) => [index("account_userId_idx").on(table.userId)],
);

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
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

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
    installedByUserId: text("installed_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    installedAt: timestamp("installed_at").defaultNow().notNull(),
    lastSyncedAt: timestamp("last_synced_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("workspace_provider_installation_idx").on(
      table.provider,
      table.providerInstallationId,
    ),
    uniqueIndex("workspace_provider_account_idx").on(
      table.provider,
      table.providerAccountId,
    ),
    index("workspace_installed_by_user_id_idx").on(table.installedByUserId),
  ],
);

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
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("workspace_member_workspace_user_idx").on(
      table.workspaceId,
      table.userId,
    ),
    index("workspace_member_user_id_idx").on(table.userId),
  ],
);

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
    archived: boolean("archived").default(false).notNull(),
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
      table.providerRepositoryId,
    ),
    index("repository_workspace_id_idx").on(table.workspaceId),
  ],
);

export const reviewConfig = pgTable(
  "review_config",
  {
    id: text("id").primaryKey(),
    repositoryId: text("repository_id")
      .notNull()
      .references(() => repository.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").default(true).notNull(),
    reviewPullRequests: boolean("review_pull_requests").default(true).notNull(),
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
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [uniqueIndex("review_config_repository_id_idx").on(table.repositoryId)],
);

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
    processedAt: timestamp("processed_at"),
  },
  (table) => [
    uniqueIndex("webhook_event_provider_delivery_idx").on(
      table.provider,
      table.deliveryId,
    ),
    index("webhook_event_workspace_id_idx").on(table.workspaceId),
  ],
);

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  installedWorkspaces: many(workspace),
  workspaceMemberships: many(workspaceMember),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));

export const workspaceRelations = relations(workspace, ({ one, many }) => ({
  installedByUser: one(user, {
    fields: [workspace.installedByUserId],
    references: [user.id],
  }),
  members: many(workspaceMember),
  repositories: many(repository),
  webhookEvents: many(webhookEvent),
}));

export const workspaceMemberRelations = relations(workspaceMember, ({ one }) => ({
  workspace: one(workspace, {
    fields: [workspaceMember.workspaceId],
    references: [workspace.id],
  }),
  user: one(user, {
    fields: [workspaceMember.userId],
    references: [user.id],
  }),
}));

export const repositoryRelations = relations(repository, ({ one }) => ({
  workspace: one(workspace, {
    fields: [repository.workspaceId],
    references: [workspace.id],
  }),
  reviewConfig: one(reviewConfig),
}));

export const reviewConfigRelations = relations(reviewConfig, ({ one }) => ({
  repository: one(repository, {
    fields: [reviewConfig.repositoryId],
    references: [repository.id],
  }),
}));

export const webhookEventRelations = relations(webhookEvent, ({ one }) => ({
  workspace: one(workspace, {
    fields: [webhookEvent.workspaceId],
    references: [workspace.id],
  }),
}));
