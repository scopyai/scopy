ALTER TABLE "workspace" ADD COLUMN "natural_language_rules" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "repository" ADD COLUMN "natural_language_rules" jsonb;--> statement-breakpoint
