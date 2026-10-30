ALTER TABLE "ingest_sources" ADD COLUMN "venue_id" uuid;--> statement-breakpoint
ALTER TABLE "ingest_sources" ADD CONSTRAINT "ingest_sources_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Backfill: an official source gets the venue that more than half of its accepted events are at
UPDATE "ingest_sources" s SET "venue_id" = top."venue_id"
FROM (
  SELECT DISTINCT ON (i."source_id") i."source_id", e."venue_id", count(*) AS n,
    sum(count(*)) OVER (PARTITION BY i."source_id") AS total
  FROM "ingest_items" i
  JOIN "events" e ON e."id" = i."event_id"
  WHERE i."status" = 'accepted' AND e."venue_id" IS NOT NULL
  GROUP BY i."source_id", e."venue_id"
  ORDER BY i."source_id", count(*) DESC
) top
WHERE s."id" = top."source_id" AND s."official" AND top.n * 2 > top.total;
