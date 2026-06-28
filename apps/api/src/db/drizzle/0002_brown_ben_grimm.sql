ALTER TYPE "public"."workspace_credit_transaction_type" ADD VALUE 'starter_grant';--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "starter_granted_at" timestamp;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "starter_creem_checkout_id" text;