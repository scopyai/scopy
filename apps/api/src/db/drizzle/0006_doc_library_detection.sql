ALTER TABLE "repository" ADD COLUMN "detected_doc_libraries" jsonb;--> statement-breakpoint
ALTER TABLE "repository" ADD COLUMN "doc_libraries_detected_at" timestamp;--> statement-breakpoint
ALTER TABLE "repository" ADD COLUMN "excluded_doc_libraries" jsonb;
