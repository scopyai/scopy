ALTER TABLE "repository" ADD COLUMN "pull_request_sync_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "repository" ADD COLUMN "pull_request_sync_started_at" timestamp;--> statement-breakpoint
ALTER TABLE "repository" ADD COLUMN "pull_request_synced_at" timestamp;