DROP TABLE "review_config" CASCADE;--> statement-breakpoint
ALTER TABLE "repository" ADD COLUMN "review_drafts" boolean;--> statement-breakpoint
ALTER TABLE "repository" ADD COLUMN "base_branch_patterns" jsonb;--> statement-breakpoint
ALTER TABLE "repository" ADD COLUMN "path_include_patterns" jsonb;--> statement-breakpoint
ALTER TABLE "repository" ADD COLUMN "path_exclude_patterns" jsonb;--> statement-breakpoint
ALTER TABLE "repository" ADD COLUMN "max_review_changed_lines" integer;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "review_drafts" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "base_branch_patterns" jsonb DEFAULT '["main","master"]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "path_include_patterns" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "path_exclude_patterns" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "max_review_changed_lines" integer DEFAULT 15000 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ALTER COLUMN "max_review_changed_lines" DROP DEFAULT;
