DROP INDEX IF EXISTS "repository_context_repository_id_idx";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "repository_context_repository_id_base_sha_idx" ON "repository_context" ("repository_id","base_sha");
