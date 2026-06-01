ALTER TABLE "workspace_billing_account" ADD COLUMN "pending_tier" "workspace_billing_tier";--> statement-breakpoint
ALTER TABLE "workspace_billing_account" ADD COLUMN "pending_product_id" text;--> statement-breakpoint
ALTER TABLE "workspace_billing_account" ADD COLUMN "pending_change_at" timestamp;