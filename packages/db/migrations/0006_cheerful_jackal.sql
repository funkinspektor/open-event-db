CREATE TYPE "public"."event_category" AS ENUM('concert', 'party');--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "categories" "event_category"[] DEFAULT ARRAY[]::event_category[] NOT NULL;--> statement-breakpoint
CREATE INDEX "events_categories_gin_idx" ON "events" USING gin ("categories");