CREATE TYPE "public"."review_finding_severity" AS ENUM('critical', 'high', 'medium', 'low');--> statement-breakpoint
CREATE TABLE "review_finding" (
	"id" text PRIMARY KEY NOT NULL,
	"review_run_id" text NOT NULL,
	"severity" "review_finding_severity" NOT NULL,
	"file" text NOT NULL,
	"start_line" integer NOT NULL,
	"end_line" integer NOT NULL,
	"title" text NOT NULL,
	"confidence" real NOT NULL,
	"language" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "review_finding" ADD CONSTRAINT "review_finding_review_run_id_review_run_id_fk" FOREIGN KEY ("review_run_id") REFERENCES "public"."review_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "review_finding_review_run_id_idx" ON "review_finding" USING btree ("review_run_id");--> statement-breakpoint
CREATE INDEX "review_finding_severity_idx" ON "review_finding" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "review_finding_file_idx" ON "review_finding" USING btree ("file");--> statement-breakpoint
CREATE INDEX "review_finding_language_idx" ON "review_finding" USING btree ("language");
