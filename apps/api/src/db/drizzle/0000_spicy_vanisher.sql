CREATE TYPE "public"."doc_source_status" AS ENUM('idle', 'crawling', 'error');--> statement-breakpoint
CREATE TYPE "public"."provider_account_type" AS ENUM('user', 'organization');--> statement-breakpoint
CREATE TYPE "public"."pull_request_state" AS ENUM('open', 'closed', 'merged');--> statement-breakpoint
CREATE TYPE "public"."pull_request_timeline_event_type" AS ENUM('lifecycle', 'issue_comment', 'review', 'review_comment');--> statement-breakpoint
CREATE TYPE "public"."repository_selection" AS ENUM('all', 'selected');--> statement-breakpoint
CREATE TYPE "public"."review_finding_severity" AS ENUM('critical', 'high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."review_run_status" AS ENUM('queued', 'running', 'completed', 'skipped', 'failed', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."user_onboarding_status" AS ENUM('connect_github', 'select_repositories', 'done');--> statement-breakpoint
CREATE TYPE "public"."workspace_billing_tier" AS ENUM('free', 'premium', 'ultra', 'enterprise');--> statement-breakpoint
CREATE TYPE "public"."workspace_charge_type" AS ENUM('payment', 'refund', 'dispute');--> statement-breakpoint
CREATE TYPE "public"."workspace_connection_status" AS ENUM('active', 'suspended', 'deleted');--> statement-breakpoint
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
CREATE TABLE "doc_chunk" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"page_id" text NOT NULL,
	"ord" integer NOT NULL,
	"heading" text,
	"content_md" text NOT NULL,
	"content_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', content_md)) STORED,
	"approx_tokens" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "doc_page" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"content_hash" text NOT NULL,
	"approx_tokens" integer DEFAULT 0 NOT NULL,
	"last_seen_crawl_id" text NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "doc_source" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"llms_txt_url" text NOT NULL,
	"active_crawl_id" text,
	"toc" jsonb,
	"page_count" integer DEFAULT 0 NOT NULL,
	"status" "doc_source_status" DEFAULT 'idle' NOT NULL,
	"last_error" text,
	"last_crawled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
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
	"review_drafts" boolean,
	"base_branch_patterns" jsonb,
	"path_include_patterns" jsonb,
	"path_exclude_patterns" jsonb,
	"natural_language_rules" jsonb,
	"max_review_changed_lines" integer,
	"detected_doc_libraries" jsonb,
	"doc_libraries_detected_at" timestamp,
	"excluded_doc_libraries" jsonb,
	"archived" boolean DEFAULT false NOT NULL,
	"provider_access_removed_at" timestamp,
	"last_synced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repository_context" (
	"id" text PRIMARY KEY NOT NULL,
	"repository_id" text NOT NULL,
	"base_sha" text NOT NULL,
	"model_id" text NOT NULL,
	"markdown" text NOT NULL,
	"summary" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"generated_at" timestamp DEFAULT now() NOT NULL,
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
CREATE TABLE "review_memory" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"repository_id" text,
	"content" text NOT NULL,
	"path_glob" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"source_comment_id" text,
	"source_comment_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_run" (
	"id" text PRIMARY KEY NOT NULL,
	"pull_request_id" text NOT NULL,
	"trigger_webhook_event_id" text,
	"head_sha" text NOT NULL,
	"provider_check_run_id" text,
	"check_sync_error" text,
	"status" "review_run_status" DEFAULT 'queued' NOT NULL,
	"result" jsonb,
	"error" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"review_run_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"repository_id" text,
	"pull_request_id" text,
	"credits_charged" integer DEFAULT 0 NOT NULL,
	"included_credits_charged" integer DEFAULT 0 NOT NULL,
	"purchased_credits_charged" integer DEFAULT 0 NOT NULL,
	"credit_balance_after" integer DEFAULT 0 NOT NULL,
	"reviewable_additions" integer DEFAULT 0 NOT NULL,
	"reviewable_deletions" integer DEFAULT 0 NOT NULL,
	"reviewable_changed_lines" integer DEFAULT 0 NOT NULL,
	"model_id" text NOT NULL,
	"verifier_model_id" text NOT NULL,
	"llm_cost_microcents" bigint NOT NULL,
	"vector_write_cost_microcents" bigint DEFAULT 0 NOT NULL,
	"vector_query_cost_microcents" bigint DEFAULT 0 NOT NULL,
	"vector_network_cost_microcents" bigint DEFAULT 0 NOT NULL,
	"total_cost_microcents" bigint NOT NULL,
	"vector_write_bytes" bigint DEFAULT 0 NOT NULL,
	"vector_query_bytes" bigint DEFAULT 0 NOT NULL,
	"vector_network_bytes" bigint DEFAULT 0 NOT NULL,
	"vector_query_count" integer DEFAULT 0 NOT NULL,
	"models" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
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
	"review_drafts" boolean DEFAULT false NOT NULL,
	"base_branch_patterns" jsonb DEFAULT '["main","master"]'::jsonb NOT NULL,
	"path_include_patterns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"path_exclude_patterns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"natural_language_rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"max_review_changed_lines" integer NOT NULL,
	"installed_by_user_id" text,
	"installed_at" timestamp DEFAULT now() NOT NULL,
	"last_synced_at" timestamp,
	"billing_tier" "workspace_billing_tier" DEFAULT 'free' NOT NULL,
	"billing_status" text DEFAULT 'free' NOT NULL,
	"included_credit_balance" integer DEFAULT 0 NOT NULL,
	"purchased_credit_balance" integer DEFAULT 0 NOT NULL,
	"creem_customer_id" text,
	"creem_subscription_id" text,
	"last_credit_reset_key" text,
	"billing_period_start" timestamp,
	"billing_period_end" timestamp,
	"pending_billing_tier" "workspace_billing_tier",
	"creem_last_event_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_charge" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"creem_transaction_id" text NOT NULL,
	"type" "workspace_charge_type" NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"status" text NOT NULL,
	"credits" integer,
	"description" text,
	"product_id" text,
	"tier" text,
	"created_at" timestamp NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL
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
ALTER TABLE "doc_chunk" ADD CONSTRAINT "doc_chunk_source_id_doc_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."doc_source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_chunk" ADD CONSTRAINT "doc_chunk_page_id_doc_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."doc_page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_page" ADD CONSTRAINT "doc_page_source_id_doc_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."doc_source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_source" ADD CONSTRAINT "doc_source_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request" ADD CONSTRAINT "pull_request_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request_timeline_event" ADD CONSTRAINT "pull_request_timeline_event_pull_request_id_pull_request_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository" ADD CONSTRAINT "repository_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_context" ADD CONSTRAINT "repository_context_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_finding" ADD CONSTRAINT "review_finding_review_run_id_review_run_id_fk" FOREIGN KEY ("review_run_id") REFERENCES "public"."review_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_memory" ADD CONSTRAINT "review_memory_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_memory" ADD CONSTRAINT "review_memory_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_run" ADD CONSTRAINT "review_run_pull_request_id_pull_request_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_run" ADD CONSTRAINT "review_run_trigger_webhook_event_id_webhook_event_id_fk" FOREIGN KEY ("trigger_webhook_event_id") REFERENCES "public"."webhook_event"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_usage" ADD CONSTRAINT "review_usage_review_run_id_review_run_id_fk" FOREIGN KEY ("review_run_id") REFERENCES "public"."review_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_usage" ADD CONSTRAINT "review_usage_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_usage" ADD CONSTRAINT "review_usage_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_usage" ADD CONSTRAINT "review_usage_pull_request_id_pull_request_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_request"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_event" ADD CONSTRAINT "webhook_event_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_installed_by_user_id_user_id_fk" FOREIGN KEY ("installed_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_charge" ADD CONSTRAINT "workspace_charge_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_member" ADD CONSTRAINT "workspace_member_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_member" ADD CONSTRAINT "workspace_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_member" ADD CONSTRAINT "workspace_member_invited_by_user_id_user_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "doc_chunk_page_id_ord_idx" ON "doc_chunk" USING btree ("page_id","ord");--> statement-breakpoint
CREATE INDEX "doc_chunk_source_id_idx" ON "doc_chunk" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "doc_chunk_content_fts_idx" ON "doc_chunk" USING gin ("content_tsv");--> statement-breakpoint
CREATE UNIQUE INDEX "doc_page_source_id_url_idx" ON "doc_page" USING btree ("source_id","url");--> statement-breakpoint
CREATE INDEX "doc_page_source_last_seen_idx" ON "doc_page" USING btree ("source_id","last_seen_crawl_id");--> statement-breakpoint
CREATE UNIQUE INDEX "doc_source_global_slug_idx" ON "doc_source" USING btree ("slug") WHERE "doc_source"."workspace_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "doc_source_workspace_slug_idx" ON "doc_source" USING btree ("workspace_id","slug") WHERE "doc_source"."workspace_id" is not null;--> statement-breakpoint
CREATE INDEX "doc_source_workspace_id_idx" ON "doc_source" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pull_request_repository_provider_id_idx" ON "pull_request" USING btree ("repository_id","provider_pull_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pull_request_repository_number_idx" ON "pull_request" USING btree ("repository_id","number");--> statement-breakpoint
CREATE INDEX "pull_request_repository_id_idx" ON "pull_request" USING btree ("repository_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pull_request_timeline_external_key_idx" ON "pull_request_timeline_event" USING btree ("pull_request_id","external_key");--> statement-breakpoint
CREATE INDEX "pull_request_timeline_pull_request_id_idx" ON "pull_request_timeline_event" USING btree ("pull_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "repository_workspace_provider_id_idx" ON "repository" USING btree ("workspace_id","provider_repository_id");--> statement-breakpoint
CREATE INDEX "repository_workspace_id_idx" ON "repository" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "repository_context_repository_id_base_sha_idx" ON "repository_context" USING btree ("repository_id","base_sha");--> statement-breakpoint
CREATE INDEX "repository_context_base_sha_idx" ON "repository_context" USING btree ("base_sha");--> statement-breakpoint
CREATE INDEX "review_finding_review_run_id_idx" ON "review_finding" USING btree ("review_run_id");--> statement-breakpoint
CREATE INDEX "review_finding_severity_idx" ON "review_finding" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "review_finding_file_idx" ON "review_finding" USING btree ("file");--> statement-breakpoint
CREATE INDEX "review_finding_language_idx" ON "review_finding" USING btree ("language");--> statement-breakpoint
CREATE INDEX "review_memory_workspace_id_idx" ON "review_memory" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "review_memory_repository_id_idx" ON "review_memory" USING btree ("repository_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_memory_source_comment_id_idx" ON "review_memory" USING btree ("source_comment_id");--> statement-breakpoint
CREATE INDEX "review_run_pull_request_head_sha_idx" ON "review_run" USING btree ("pull_request_id","head_sha");--> statement-breakpoint
CREATE INDEX "review_run_pull_request_id_idx" ON "review_run" USING btree ("pull_request_id");--> statement-breakpoint
CREATE INDEX "review_run_trigger_webhook_event_id_idx" ON "review_run" USING btree ("trigger_webhook_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_usage_review_run_id_idx" ON "review_usage" USING btree ("review_run_id");--> statement-breakpoint
CREATE INDEX "review_usage_workspace_created_at_idx" ON "review_usage" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "review_usage_repository_id_idx" ON "review_usage" USING btree ("repository_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_event_provider_delivery_idx" ON "webhook_event" USING btree ("provider","delivery_id");--> statement-breakpoint
CREATE INDEX "webhook_event_workspace_id_idx" ON "webhook_event" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_provider_installation_idx" ON "workspace" USING btree ("provider","provider_installation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_provider_account_idx" ON "workspace" USING btree ("provider","provider_account_id");--> statement-breakpoint
CREATE INDEX "workspace_installed_by_user_id_idx" ON "workspace" USING btree ("installed_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_creem_subscription_id_idx" ON "workspace" USING btree ("creem_subscription_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_charge_creem_transaction_id_idx" ON "workspace_charge" USING btree ("creem_transaction_id");--> statement-breakpoint
CREATE INDEX "workspace_charge_workspace_created_at_idx" ON "workspace_charge" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_member_workspace_user_idx" ON "workspace_member" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "workspace_member_user_id_idx" ON "workspace_member" USING btree ("user_id");