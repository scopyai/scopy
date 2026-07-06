ALTER TABLE "workspace" ADD COLUMN "included_credit_balance" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "purchased_credit_balance" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "review_usage" ADD COLUMN "credits_charged" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "review_usage" ADD COLUMN "included_credits_charged" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "review_usage" ADD COLUMN "purchased_credits_charged" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "review_usage" ADD COLUMN "credit_balance_after" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "review_usage" ADD COLUMN "reviewable_additions" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "review_usage" ADD COLUMN "reviewable_deletions" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "review_usage" ADD COLUMN "reviewable_changed_lines" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "review_usage" DROP COLUMN "balance_after";--> statement-breakpoint
ALTER TABLE "workspace_charge" ADD COLUMN "credits" integer;--> statement-breakpoint
ALTER TABLE "workspace" DROP COLUMN "credit_balance";--> statement-breakpoint
