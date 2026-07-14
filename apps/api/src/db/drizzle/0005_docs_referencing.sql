CREATE TYPE "public"."doc_source_status" AS ENUM('idle', 'crawling', 'error');--> statement-breakpoint
CREATE TABLE "doc_source" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"llms_txt_url" text NOT NULL,
	"active_crawl_id" text,
	"toc" jsonb,
	"page_count" integer DEFAULT 0 NOT NULL,
	"status" "doc_source_status" DEFAULT 'idle' NOT NULL,
	"last_error" text,
	"last_crawled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "doc_page" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"content_hash" text NOT NULL,
	"approx_tokens" integer DEFAULT 0 NOT NULL,
	"last_seen_crawl_id" text NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "doc_chunk" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"page_id" text NOT NULL,
	"ord" integer NOT NULL,
	"heading" text,
	"content_md" text NOT NULL,
	"content_tsv" tsvector GENERATED ALWAYS AS (to_tsvector('english', content_md)) STORED,
	"approx_tokens" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "doc_source" ADD CONSTRAINT "doc_source_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_page" ADD CONSTRAINT "doc_page_source_id_doc_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."doc_source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_chunk" ADD CONSTRAINT "doc_chunk_source_id_doc_source_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."doc_source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_chunk" ADD CONSTRAINT "doc_chunk_page_id_doc_page_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."doc_page"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "doc_source_global_slug_idx" ON "doc_source" ("slug") WHERE "workspace_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "doc_source_workspace_slug_idx" ON "doc_source" ("workspace_id","slug") WHERE "workspace_id" is not null;--> statement-breakpoint
CREATE INDEX "doc_source_workspace_id_idx" ON "doc_source" ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "doc_page_source_id_url_idx" ON "doc_page" ("source_id","url");--> statement-breakpoint
CREATE INDEX "doc_page_source_last_seen_idx" ON "doc_page" ("source_id","last_seen_crawl_id");--> statement-breakpoint
CREATE UNIQUE INDEX "doc_chunk_page_id_ord_idx" ON "doc_chunk" ("page_id","ord");--> statement-breakpoint
CREATE INDEX "doc_chunk_source_id_idx" ON "doc_chunk" ("source_id");--> statement-breakpoint
CREATE INDEX "doc_chunk_content_fts_idx" ON "doc_chunk" USING gin ("content_tsv");
