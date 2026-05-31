CREATE TYPE "public"."pull_request_state" AS ENUM('open', 'closed', 'merged');--> statement-breakpoint
CREATE TYPE "public"."pull_request_timeline_event_type" AS ENUM('lifecycle', 'issue_comment', 'review', 'review_comment');--> statement-breakpoint
CREATE TABLE "pull_request" (
	"id" text PRIMARY KEY NOT NULL,
	"repository_id" text NOT NULL,
	"provider_pull_request_id" text NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"html_url" text NOT NULL,
	"author" jsonb,
	"state" "pull_request_state" NOT NULL,
	"draft" boolean DEFAULT false NOT NULL,
	"base_ref" text NOT NULL,
	"head_ref" text NOT NULL,
	"head_sha" text NOT NULL,
	"labels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"assignees" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"opened_at" timestamp NOT NULL,
	"closed_at" timestamp,
	"merged_at" timestamp,
	"provider_created_at" timestamp NOT NULL,
	"provider_updated_at" timestamp NOT NULL,
	"last_synced_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pull_request_timeline_event" (
	"id" text PRIMARY KEY NOT NULL,
	"pull_request_id" text NOT NULL,
	"event_type" "pull_request_timeline_event_type" NOT NULL,
	"external_key" text NOT NULL,
	"action" text,
	"author" jsonb,
	"body" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"html_url" text,
	"provider_created_at" timestamp NOT NULL,
	"provider_updated_at" timestamp NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "repository" ADD COLUMN "provider_access_removed_at" timestamp;--> statement-breakpoint
ALTER TABLE "webhook_event" ADD COLUMN "processing_error" text;--> statement-breakpoint
ALTER TABLE "pull_request" ADD CONSTRAINT "pull_request_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request_timeline_event" ADD CONSTRAINT "pull_request_timeline_event_pull_request_id_pull_request_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pull_request_repository_provider_id_idx" ON "pull_request" USING btree ("repository_id","provider_pull_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pull_request_repository_number_idx" ON "pull_request" USING btree ("repository_id","number");--> statement-breakpoint
CREATE INDEX "pull_request_repository_id_idx" ON "pull_request" USING btree ("repository_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pull_request_timeline_external_key_idx" ON "pull_request_timeline_event" USING btree ("pull_request_id","external_key");--> statement-breakpoint
CREATE INDEX "pull_request_timeline_pull_request_id_idx" ON "pull_request_timeline_event" USING btree ("pull_request_id");