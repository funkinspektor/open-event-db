CREATE TYPE "public"."ingest_fit_verdict" AS ENUM('fit', 'maybe', 'no');--> statement-breakpoint
ALTER TABLE "ingest_items" ADD COLUMN "fit_verdict" "ingest_fit_verdict";--> statement-breakpoint
ALTER TABLE "ingest_items" ADD COLUMN "fit_reason" text;--> statement-breakpoint
ALTER TABLE "ingest_items" ADD COLUMN "fit_scored_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ingest_items" ADD COLUMN "fit_fingerprint" text;--> statement-breakpoint
ALTER TABLE "ingest_items" ADD COLUMN "had_duplicates" boolean DEFAULT false NOT NULL;