ALTER TABLE "review_memory" DROP CONSTRAINT "review_memory_workspace_id_workspace_id_fk";
--> statement-breakpoint
DROP INDEX "review_memory_workspace_id_idx";--> statement-breakpoint
ALTER TABLE "review_memory" ALTER COLUMN "repository_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "review_memory" DROP COLUMN "workspace_id";