CREATE TABLE "repository_context" (
	"id" text PRIMARY KEY NOT NULL,
	"repository_id" text NOT NULL,
	"base_sha" text NOT NULL,
	"model_id" text NOT NULL,
	"markdown" text NOT NULL,
	"summary" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"generated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "repository_context" ADD CONSTRAINT "repository_context_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "repository_context_repository_id_idx" ON "repository_context" USING btree ("repository_id");
--> statement-breakpoint
CREATE INDEX "repository_context_base_sha_idx" ON "repository_context" USING btree ("base_sha");
