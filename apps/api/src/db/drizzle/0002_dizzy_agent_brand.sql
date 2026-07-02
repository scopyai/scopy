CREATE TYPE "public"."provider_key_provider" AS ENUM('openrouter', 'gateway');--> statement-breakpoint
CREATE TYPE "public"."review_billing_mode" AS ENUM('platform', 'byok');--> statement-breakpoint
CREATE TABLE "workspace_provider_key" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"provider" "provider_key_provider" NOT NULL,
	"envelope" text NOT NULL,
	"key_preview" text NOT NULL,
	"created_by_user_id" text,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "repository" ADD COLUMN "review_billing_mode" "review_billing_mode";--> statement-breakpoint
ALTER TABLE "repository" ADD COLUMN "byok_provider" "provider_key_provider";--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "review_billing_mode" "review_billing_mode" DEFAULT 'platform' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "byok_provider" "provider_key_provider";--> statement-breakpoint
ALTER TABLE "workspace_provider_key" ADD CONSTRAINT "workspace_provider_key_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_provider_key" ADD CONSTRAINT "workspace_provider_key_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_provider_key_workspace_provider_idx" ON "workspace_provider_key" USING btree ("workspace_id","provider");