UPDATE "repository"
SET "pull_request_sync_status" = 'pending'
WHERE "pull_request_sync_status" = 'queued';
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "job_outbox"
    WHERE "published_at" IS NULL
      AND "failed_at" IS NULL
  ) THEN
    RAISE EXCEPTION 'Cannot remove job_outbox while jobs are pending';
  END IF;
END
$$;
--> statement-breakpoint
DROP TABLE "job_outbox";
