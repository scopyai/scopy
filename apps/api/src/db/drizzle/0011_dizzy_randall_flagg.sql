CREATE TYPE "public"."workspace_member_status" AS ENUM('active', 'pending');--> statement-breakpoint
ALTER TABLE "workspace_member" ADD COLUMN "status" "workspace_member_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_member" ADD COLUMN "invited_by_user_id" text;--> statement-breakpoint
ALTER TABLE "workspace_member" ADD COLUMN "invited_at" timestamp;--> statement-breakpoint
ALTER TABLE "workspace_member" ADD COLUMN "accepted_at" timestamp;--> statement-breakpoint
ALTER TABLE "workspace_member" ADD CONSTRAINT "workspace_member_invited_by_user_id_user_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;