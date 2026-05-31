CREATE TYPE "public"."review_run_status" AS ENUM('queued', 'running', 'completed', 'skipped', 'failed', 'superseded');--> statement-breakpoint
CREATE TABLE "review_run" (
	"id" text PRIMARY KEY NOT NULL,
	"pull_request_id" text NOT NULL,
	"trigger_webhook_event_id" text,
	"head_sha" text NOT NULL,
	"status" "review_run_status" DEFAULT 'queued' NOT NULL,
	"result" jsonb,
	"error" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "review_run" ADD CONSTRAINT "review_run_pull_request_id_pull_request_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_run" ADD CONSTRAINT "review_run_trigger_webhook_event_id_webhook_event_id_fk" FOREIGN KEY ("trigger_webhook_event_id") REFERENCES "public"."webhook_event"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "review_run_pull_request_head_sha_idx" ON "review_run" USING btree ("pull_request_id","head_sha");--> statement-breakpoint
CREATE INDEX "review_run_pull_request_id_idx" ON "review_run" USING btree ("pull_request_id");--> statement-breakpoint
CREATE INDEX "review_run_trigger_webhook_event_id_idx" ON "review_run" USING btree ("trigger_webhook_event_id");