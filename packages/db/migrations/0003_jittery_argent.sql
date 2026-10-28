CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TYPE "public"."ingest_item_status" AS ENUM('pending', 'accepted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."ingest_source_kind" AS ENUM('ical');--> statement-breakpoint
CREATE TABLE "ingest_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"status" "ingest_item_status" DEFAULT 'pending' NOT NULL,
	"draft" jsonb NOT NULL,
	"raw" text NOT NULL,
	"content_hash" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"gone_at" timestamp with time zone,
	"gone_resolved_at" timestamp with time zone,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"event_id" uuid,
	"detached_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ingest_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"kind" "ingest_source_kind" NOT NULL,
	"url" text NOT NULL,
	"publisher_id" uuid NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_error" text,
	"last_item_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ingest_sources_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "ingest_items" ADD CONSTRAINT "ingest_items_source_id_ingest_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."ingest_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_items" ADD CONSTRAINT "ingest_items_decided_by_publishers_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."publishers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_items" ADD CONSTRAINT "ingest_items_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingest_sources" ADD CONSTRAINT "ingest_sources_publisher_id_publishers_id_fk" FOREIGN KEY ("publisher_id") REFERENCES "public"."publishers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ingest_items_source_external" ON "ingest_items" USING btree ("source_id","external_id");--> statement-breakpoint
CREATE INDEX "ingest_items_event_idx" ON "ingest_items" USING btree ("event_id");