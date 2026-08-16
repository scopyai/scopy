ALTER TABLE "job_outbox" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "job_outbox" CASCADE;--> statement-breakpoint
DROP INDEX "pull_request_repository_id_idx";--> statement-breakpoint
DROP INDEX "pull_request_timeline_pull_request_id_idx";--> statement-breakpoint
DROP INDEX "repository_workspace_id_idx";--> statement-breakpoint
DROP INDEX "review_run_pull_request_id_idx";--> statement-breakpoint
ALTER TABLE "repository" ADD COLUMN "pull_request_sync_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "pull_request" DROP COLUMN "last_synced_at";--> statement-breakpoint
ALTER TABLE "repository" DROP COLUMN "last_synced_at";--> statement-breakpoint
ALTER TABLE "webhook_event" DROP COLUMN "processing_started_at";--> statement-breakpoint
ALTER TABLE "webhook_event" DROP COLUMN "processing_error";--> statement-breakpoint
ALTER TABLE "workspace" DROP COLUMN "last_synced_at";