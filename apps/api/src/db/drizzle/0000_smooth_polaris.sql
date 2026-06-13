CREATE TYPE "public"."provider_account_type" AS ENUM('user', 'organization');--> statement-breakpoint
CREATE TYPE "public"."pull_request_state" AS ENUM('open', 'closed', 'merged');--> statement-breakpoint
CREATE TYPE "public"."pull_request_timeline_event_type" AS ENUM('lifecycle', 'issue_comment', 'review', 'review_comment');--> statement-breakpoint
CREATE TYPE "public"."repository_selection" AS ENUM('all', 'selected');--> statement-breakpoint
CREATE TYPE "public"."review_finding_severity" AS ENUM('critical', 'high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."review_run_status" AS ENUM('queued', 'running', 'completed', 'skipped', 'failed', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."user_onboarding_status" AS ENUM('connect_github', 'select_repositories', 'done');--> statement-breakpoint
CREATE TYPE "public"."workspace_billing_tier" AS ENUM('free', 'premium', 'ultra', 'enterprise');--> statement-breakpoint
CREATE TYPE "public"."workspace_connection_status" AS ENUM('active', 'suspended', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."workspace_credit_transaction_type" AS ENUM('reset', 'revoke', 'usage_debit');--> statement-breakpoint
CREATE TYPE "public"."workspace_member_role" AS ENUM('owner', 'admin', 'member');--> statement-breakpoint
CREATE TYPE "public"."workspace_member_status" AS ENUM('active', 'pending');--> statement-breakpoint
CREATE TYPE "public"."workspace_provider" AS ENUM('github');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pull_request" (
	"id" text PRIMARY KEY NOT NULL,
	"repository_id" text NOT NULL,
	"provider_pull_request_id" text NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"html_url" text NOT NULL,
	"author" jsonb,
	"state" "pull_request_state" NOT NULL,
	"draft" boolean DEFAULT false NOT NULL,
	"base_ref" text NOT NULL,
	"head_ref" text NOT NULL,
	"head_sha" text NOT NULL,
	"labels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"assignees" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"opened_at" timestamp NOT NULL,
	"closed_at" timestamp,
	"merged_at" timestamp,
	"provider_created_at" timestamp NOT NULL,
	"provider_updated_at" timestamp NOT NULL,
	"last_synced_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pull_request_timeline_event" (
	"id" text PRIMARY KEY NOT NULL,
	"pull_request_id" text NOT NULL,
	"event_type" "pull_request_timeline_event_type" NOT NULL,
	"external_key" text NOT NULL,
	"action" text,
	"author" jsonb,
	"body" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"html_url" text,
	"provider_created_at" timestamp NOT NULL,
	"provider_updated_at" timestamp NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repository" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"provider_repository_id" text NOT NULL,
	"name" text NOT NULL,
	"full_name" text NOT NULL,
	"owner" text NOT NULL,
	"private" boolean NOT NULL,
	"default_branch" text,
	"html_url" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"provider_access_removed_at" timestamp,
	"last_synced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_config" (
	"id" text PRIMARY KEY NOT NULL,
	"repository_id" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"review_pull_requests" boolean DEFAULT true NOT NULL,
	"review_drafts" boolean DEFAULT false NOT NULL,
	"base_branch_patterns" jsonb DEFAULT '["main","master"]'::jsonb NOT NULL,
	"path_include_patterns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"path_exclude_patterns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_finding" (
	"id" text PRIMARY KEY NOT NULL,
	"review_run_id" text NOT NULL,
	"severity" "review_finding_severity" NOT NULL,
	"file" text NOT NULL,
	"start_line" integer NOT NULL,
	"end_line" integer NOT NULL,
	"title" text NOT NULL,
	"confidence" real NOT NULL,
	"language" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_run" (
	"id" text PRIMARY KEY NOT NULL,
	"pull_request_id" text NOT NULL,
	"trigger_webhook_event_id" text,
	"head_sha" text NOT NULL,
	"status" "review_run_status" DEFAULT 'queued' NOT NULL,
	"result" jsonb,
	"error" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"onboarding_status" "user_onboarding_status" DEFAULT 'connect_github' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_event" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" "workspace_provider" NOT NULL,
	"delivery_id" text NOT NULL,
	"event_name" text NOT NULL,
	"action" text,
	"workspace_id" text,
	"payload" jsonb NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"processing_started_at" timestamp,
	"processed_at" timestamp,
	"processing_error" text
);
--> statement-breakpoint
CREATE TABLE "workspace" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" "workspace_provider" NOT NULL,
	"provider_installation_id" text NOT NULL,
	"provider_account_id" text NOT NULL,
	"provider_account_login" text NOT NULL,
	"provider_account_type" "provider_account_type" NOT NULL,
	"provider_account_avatar_url" text,
	"name" text NOT NULL,
	"repository_selection" "repository_selection" NOT NULL,
	"permissions" jsonb NOT NULL,
	"connection_status" "workspace_connection_status" DEFAULT 'active' NOT NULL,
	"installed_by_user_id" text,
	"installed_at" timestamp DEFAULT now() NOT NULL,
	"last_synced_at" timestamp,
	"billing_tier" "workspace_billing_tier" DEFAULT 'free' NOT NULL,
	"billing_status" text DEFAULT 'free' NOT NULL,
	"credit_balance" bigint DEFAULT 0 NOT NULL,
	"creem_customer_id" text,
	"creem_subscription_id" text,
	"billing_period_start" timestamp,
	"billing_period_end" timestamp,
	"pending_billing_tier" "workspace_billing_tier",
	"creem_last_event_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_credit_transaction" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"type" "workspace_credit_transaction_type" NOT NULL,
	"amount" bigint NOT NULL,
	"balance_after" bigint NOT NULL,
	"idempotency_key" text NOT NULL,
	"reason" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_member" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" "workspace_member_role" DEFAULT 'member' NOT NULL,
	"status" "workspace_member_status" DEFAULT 'active' NOT NULL,
	"invited_by_user_id" text,
	"invited_at" timestamp,
	"accepted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request" ADD CONSTRAINT "pull_request_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request_timeline_event" ADD CONSTRAINT "pull_request_timeline_event_pull_request_id_pull_request_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository" ADD CONSTRAINT "repository_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_config" ADD CONSTRAINT "review_config_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_finding" ADD CONSTRAINT "review_finding_review_run_id_review_run_id_fk" FOREIGN KEY ("review_run_id") REFERENCES "public"."review_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_run" ADD CONSTRAINT "review_run_pull_request_id_pull_request_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_run" ADD CONSTRAINT "review_run_trigger_webhook_event_id_webhook_event_id_fk" FOREIGN KEY ("trigger_webhook_event_id") REFERENCES "public"."webhook_event"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_event" ADD CONSTRAINT "webhook_event_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_installed_by_user_id_user_id_fk" FOREIGN KEY ("installed_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_credit_transaction" ADD CONSTRAINT "workspace_credit_transaction_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_member" ADD CONSTRAINT "workspace_member_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_member" ADD CONSTRAINT "workspace_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_member" ADD CONSTRAINT "workspace_member_invited_by_user_id_user_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pull_request_repository_provider_id_idx" ON "pull_request" USING btree ("repository_id","provider_pull_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pull_request_repository_number_idx" ON "pull_request" USING btree ("repository_id","number");--> statement-breakpoint
CREATE INDEX "pull_request_repository_id_idx" ON "pull_request" USING btree ("repository_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pull_request_timeline_external_key_idx" ON "pull_request_timeline_event" USING btree ("pull_request_id","external_key");--> statement-breakpoint
CREATE INDEX "pull_request_timeline_pull_request_id_idx" ON "pull_request_timeline_event" USING btree ("pull_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "repository_workspace_provider_id_idx" ON "repository" USING btree ("workspace_id","provider_repository_id");--> statement-breakpoint
CREATE INDEX "repository_workspace_id_idx" ON "repository" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_config_repository_id_idx" ON "review_config" USING btree ("repository_id");--> statement-breakpoint
CREATE INDEX "review_finding_review_run_id_idx" ON "review_finding" USING btree ("review_run_id");--> statement-breakpoint
CREATE INDEX "review_finding_severity_idx" ON "review_finding" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "review_finding_file_idx" ON "review_finding" USING btree ("file");--> statement-breakpoint
CREATE INDEX "review_finding_language_idx" ON "review_finding" USING btree ("language");--> statement-breakpoint
CREATE INDEX "review_run_pull_request_head_sha_idx" ON "review_run" USING btree ("pull_request_id","head_sha");--> statement-breakpoint
CREATE INDEX "review_run_pull_request_id_idx" ON "review_run" USING btree ("pull_request_id");--> statement-breakpoint
CREATE INDEX "review_run_trigger_webhook_event_id_idx" ON "review_run" USING btree ("trigger_webhook_event_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_event_provider_delivery_idx" ON "webhook_event" USING btree ("provider","delivery_id");--> statement-breakpoint
CREATE INDEX "webhook_event_workspace_id_idx" ON "webhook_event" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_provider_installation_idx" ON "workspace" USING btree ("provider","provider_installation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_provider_account_idx" ON "workspace" USING btree ("provider","provider_account_id");--> statement-breakpoint
CREATE INDEX "workspace_installed_by_user_id_idx" ON "workspace" USING btree ("installed_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_creem_subscription_id_idx" ON "workspace" USING btree ("creem_subscription_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_credit_transaction_idempotency_key_idx" ON "workspace_credit_transaction" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "workspace_credit_transaction_workspace_created_at_idx" ON "workspace_credit_transaction" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_member_workspace_user_idx" ON "workspace_member" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "workspace_member_user_id_idx" ON "workspace_member" USING btree ("user_id");