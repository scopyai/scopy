ALTER TYPE "public"."workspace_credit_transaction_type" ADD VALUE 'usage_debit';--> statement-breakpoint
ALTER TABLE "workspace" ALTER COLUMN "credit_balance" TYPE bigint USING "credit_balance"::bigint * 1000000;--> statement-breakpoint
ALTER TABLE "workspace_credit_transaction" ALTER COLUMN "amount" TYPE bigint USING "amount"::bigint * 1000000;--> statement-breakpoint
ALTER TABLE "workspace_credit_transaction" ALTER COLUMN "balance_after" TYPE bigint USING "balance_after"::bigint * 1000000;
