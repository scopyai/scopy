DROP INDEX "review_run_pull_request_head_sha_idx";--> statement-breakpoint
CREATE INDEX "review_run_pull_request_head_sha_idx" ON "review_run" USING btree ("pull_request_id","head_sha");