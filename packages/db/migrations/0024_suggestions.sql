ALTER TYPE "public"."ingest_item_status" ADD VALUE 'withdrawn';--> statement-breakpoint
ALTER TYPE "public"."ingest_source_kind" ADD VALUE 'suggestion';--> statement-breakpoint
ALTER TABLE "ingest_sources" ALTER COLUMN "account_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ingest_items" ADD COLUMN "submitted_by" uuid;--> statement-breakpoint
ALTER TABLE "ingest_items" ADD COLUMN "reject_reason" text;--> statement-breakpoint
ALTER TABLE "ingest_items" ADD COLUMN "image_key" text;--> statement-breakpoint
ALTER TABLE "ingest_items" ADD CONSTRAINT "ingest_items_submitted_by_accounts_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ingest_items_submitted_idx" ON "ingest_items" USING btree ("submitted_by","first_seen_at");--> statement-breakpoint
ALTER TABLE "ingest_sources" ADD CONSTRAINT "ingest_sources_account_required" CHECK ("ingest_sources"."kind"::text = 'suggestion' OR "ingest_sources"."account_id" IS NOT NULL);