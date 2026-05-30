CREATE TYPE "public"."provider_account_type" AS ENUM('user', 'organization');--> statement-breakpoint
CREATE TYPE "public"."repository_selection" AS ENUM('all', 'selected');--> statement-breakpoint
CREATE TYPE "public"."workspace_connection_status" AS ENUM('active', 'suspended', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."workspace_member_role" AS ENUM('owner', 'admin', 'member');--> statement-breakpoint
CREATE TYPE "public"."workspace_provider" AS ENUM('github');--> statement-breakpoint
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
CREATE TABLE "webhook_event" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" "workspace_provider" NOT NULL,
	"delivery_id" text NOT NULL,
	"event_name" text NOT NULL,
	"action" text,
	"workspace_id" text,
	"payload" jsonb NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp
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
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_member" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" "workspace_member_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "repository" ADD CONSTRAINT "repository_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_config" ADD CONSTRAINT "review_config_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_event" ADD CONSTRAINT "webhook_event_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_installed_by_user_id_user_id_fk" FOREIGN KEY ("installed_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_member" ADD CONSTRAINT "workspace_member_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_member" ADD CONSTRAINT "workspace_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "repository_workspace_provider_id_idx" ON "repository" USING btree ("workspace_id","provider_repository_id");--> statement-breakpoint
CREATE INDEX "repository_workspace_id_idx" ON "repository" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_config_repository_id_idx" ON "review_config" USING btree ("repository_id");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_event_provider_delivery_idx" ON "webhook_event" USING btree ("provider","delivery_id");--> statement-breakpoint
CREATE INDEX "webhook_event_workspace_id_idx" ON "webhook_event" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_provider_installation_idx" ON "workspace" USING btree ("provider","provider_installation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_provider_account_idx" ON "workspace" USING btree ("provider","provider_account_id");--> statement-breakpoint
CREATE INDEX "workspace_installed_by_user_id_idx" ON "workspace" USING btree ("installed_by_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_member_workspace_user_idx" ON "workspace_member" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "workspace_member_user_id_idx" ON "workspace_member" USING btree ("user_id");