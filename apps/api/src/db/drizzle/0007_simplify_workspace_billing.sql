CREATE TYPE "public"."workspace_credit_transaction_type" AS ENUM('reset', 'revoke');--> statement-breakpoint
CREATE TABLE "workspace_credit_transaction" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"type" "workspace_credit_transaction_type" NOT NULL,
	"amount" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"reason" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "creem_subscription" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workspace_billing_account" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workspace_credit_ledger" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "creem_subscription" CASCADE;--> statement-breakpoint
DROP TABLE "workspace_billing_account" CASCADE;--> statement-breakpoint
DROP TABLE "workspace_credit_ledger" CASCADE;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "billing_tier" "workspace_billing_tier" DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "billing_status" text DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "credit_balance" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "creem_customer_id" text;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "creem_subscription_id" text;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "billing_period_start" timestamp;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "billing_period_end" timestamp;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "pending_billing_tier" "workspace_billing_tier";--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "creem_last_event_at" timestamp;--> statement-breakpoint
ALTER TABLE "workspace_credit_transaction" ADD CONSTRAINT "workspace_credit_transaction_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_credit_transaction_idempotency_key_idx" ON "workspace_credit_transaction" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "workspace_credit_transaction_workspace_created_at_idx" ON "workspace_credit_transaction" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_creem_subscription_id_idx" ON "workspace" USING btree ("creem_subscription_id");--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "creem_customer_id";--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "had_trial";--> statement-breakpoint
DROP TYPE "public"."workspace_credit_ledger_event_type";