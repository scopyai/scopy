CREATE TYPE "public"."workspace_billing_tier" AS ENUM('free', 'premium', 'ultra', 'enterprise');--> statement-breakpoint
CREATE TYPE "public"."workspace_credit_ledger_event_type" AS ENUM('grant', 'consume', 'revoke', 'adjustment');--> statement-breakpoint
CREATE TABLE "creem_subscription" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"reference_id" text NOT NULL,
	"creem_customer_id" text,
	"creem_subscription_id" text,
	"creem_order_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"period_start" timestamp,
	"period_end" timestamp,
	"cancel_at_period_end" boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE "workspace_billing_account" (
	"workspace_id" text PRIMARY KEY NOT NULL,
	"creem_customer_id" text,
	"creem_subscription_id" text,
	"product_id" text,
	"tier" "workspace_billing_tier" DEFAULT 'free' NOT NULL,
	"status" text DEFAULT 'free' NOT NULL,
	"period_start" timestamp,
	"period_end" timestamp,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"monthly_allowance" integer DEFAULT 0 NOT NULL,
	"credit_balance" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_credit_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"event_type" "workspace_credit_ledger_event_type" NOT NULL,
	"delta" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"reason" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "creem_customer_id" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "had_trial" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "workspace_billing_account" ADD CONSTRAINT "workspace_billing_account_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_credit_ledger" ADD CONSTRAINT "workspace_credit_ledger_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "creem_subscription_reference_id_idx" ON "creem_subscription" USING btree ("reference_id");--> statement-breakpoint
CREATE UNIQUE INDEX "creem_subscription_creem_subscription_id_idx" ON "creem_subscription" USING btree ("creem_subscription_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_billing_account_subscription_id_idx" ON "workspace_billing_account" USING btree ("creem_subscription_id");--> statement-breakpoint
CREATE INDEX "workspace_billing_account_customer_id_idx" ON "workspace_billing_account" USING btree ("creem_customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_credit_ledger_idempotency_key_idx" ON "workspace_credit_ledger" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "workspace_credit_ledger_workspace_created_at_idx" ON "workspace_credit_ledger" USING btree ("workspace_id","created_at");