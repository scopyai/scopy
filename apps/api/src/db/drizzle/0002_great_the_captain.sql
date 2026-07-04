CREATE TYPE "public"."provider_key_provider" AS ENUM('openrouter', 'gateway');--> statement-breakpoint
CREATE TYPE "public"."review_billing_mode" AS ENUM('platform', 'byok');--> statement-breakpoint
CREATE TYPE "public"."workspace_charge_type" AS ENUM('payment', 'refund', 'dispute');--> statement-breakpoint
CREATE TABLE "review_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"review_run_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"repository_id" text,
	"pull_request_id" text,
	"billing_mode" "review_billing_mode" NOT NULL,
	"provider" "provider_key_provider",
	"provider_key_id" text,
	"key_preview" text,
	"balance_after" bigint,
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
CREATE TABLE "workspace_charge" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"creem_transaction_id" text NOT NULL,
	"type" "workspace_charge_type" NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"status" text NOT NULL,
	"description" text,
	"product_id" text,
	"tier" text,
	"created_at" timestamp NOT NULL,
	"recorded_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
DROP TABLE "workspace_credit_transaction" CASCADE;--> statement-breakpoint
ALTER TABLE "repository" ADD COLUMN "review_billing_mode" "review_billing_mode";--> statement-breakpoint
ALTER TABLE "repository" ADD COLUMN "byok_provider" "provider_key_provider";--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "review_billing_mode" "review_billing_mode" DEFAULT 'platform' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "byok_provider" "provider_key_provider";--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "last_credit_reset_key" text;--> statement-breakpoint
ALTER TABLE "review_usage" ADD CONSTRAINT "review_usage_review_run_id_review_run_id_fk" FOREIGN KEY ("review_run_id") REFERENCES "public"."review_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_usage" ADD CONSTRAINT "review_usage_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_usage" ADD CONSTRAINT "review_usage_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_usage" ADD CONSTRAINT "review_usage_pull_request_id_pull_request_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_request"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_usage" ADD CONSTRAINT "review_usage_provider_key_id_workspace_provider_key_id_fk" FOREIGN KEY ("provider_key_id") REFERENCES "public"."workspace_provider_key"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_charge" ADD CONSTRAINT "workspace_charge_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_provider_key" ADD CONSTRAINT "workspace_provider_key_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_provider_key" ADD CONSTRAINT "workspace_provider_key_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "review_usage_review_run_id_idx" ON "review_usage" USING btree ("review_run_id");--> statement-breakpoint
CREATE INDEX "review_usage_workspace_created_at_idx" ON "review_usage" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "review_usage_repository_id_idx" ON "review_usage" USING btree ("repository_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_charge_creem_transaction_id_idx" ON "workspace_charge" USING btree ("creem_transaction_id");--> statement-breakpoint
CREATE INDEX "workspace_charge_workspace_created_at_idx" ON "workspace_charge" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_provider_key_workspace_provider_idx" ON "workspace_provider_key" USING btree ("workspace_id","provider");--> statement-breakpoint
DROP TYPE "public"."workspace_credit_transaction_type";