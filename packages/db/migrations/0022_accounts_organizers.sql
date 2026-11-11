-- Splits publishers into accounts (who logs in) and organizers (who makes events). Hand-written: drizzle-kit
-- turns these renames into drop-and-create. Ids are kept, so every existing reference stays valid without
-- row updates. Drizzle runs the whole file in one transaction: a failing guard leaves the database untouched.

-- 1. Every publisher becomes an account. An unverified publisher could neither log in nor write,
--    so an unverified scout does not become a scout.
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"handle" text NOT NULL,
	"display_name" text NOT NULL,
	"is_scout" boolean DEFAULT false NOT NULL,
	"api_key_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_email_unique" UNIQUE("email"),
	CONSTRAINT "accounts_handle_unique" UNIQUE("handle")
);
--> statement-breakpoint
INSERT INTO "accounts" ("id", "email", "handle", "display_name", "is_scout", "api_key_hash", "created_at", "updated_at")
SELECT "id", "email", "slug", "name", "is_scout" AND "verified", "api_key_hash", "created_at", "updated_at"
FROM "publishers";
--> statement-breakpoint

-- 2. Every publisher that could own events becomes an organizer with the same id, keeping its verified flag.
CREATE TABLE "organizers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"links" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizers_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
INSERT INTO "organizers" ("id", "name", "slug", "links", "verified", "created_at", "updated_at")
SELECT "id", "name", "slug", "links", "verified", "created_at", "updated_at"
FROM "publishers"
WHERE "is_publisher";
--> statement-breakpoint

-- 3. The former publisher's account owns its organizer.
CREATE TYPE "public"."organizer_member_role" AS ENUM('owner', 'member');
--> statement-breakpoint
CREATE TABLE "organizer_members" (
	"organizer_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"role" "organizer_member_role" NOT NULL,
	CONSTRAINT "organizer_members_organizer_id_account_id_pk" PRIMARY KEY("organizer_id","account_id")
);
--> statement-breakpoint
ALTER TABLE "organizer_members" ADD CONSTRAINT "organizer_members_organizer_id_organizers_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "public"."organizers"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "organizer_members" ADD CONSTRAINT "organizer_members_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
INSERT INTO "organizer_members" ("organizer_id", "account_id", "role")
SELECT "id", "id", 'owner'::"organizer_member_role"
FROM "organizers";
--> statement-breakpoint

-- 4. Guards: refuse data this migration would have to drop or could not map.
DO $$ BEGIN
	IF EXISTS (
		SELECT 1 FROM "event_owners" o JOIN "publishers" p ON p."id" = o."publisher_id" WHERE NOT p."is_publisher"
	) THEN
		RAISE EXCEPTION 'event_owners rows point at publishers that are not organizers (is_publisher = false)';
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF EXISTS (SELECT 1 FROM "invites") THEN
		RAISE EXCEPTION 'invites is not empty; it is dropped by this migration';
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF EXISTS (SELECT 1 FROM "edit_history" WHERE "entity_type" = 'invite') THEN
		RAISE EXCEPTION 'edit_history has entries for invites; entity type invite is removed by this migration';
	END IF;
END $$;
--> statement-breakpoint

-- 5. event_owners becomes event_organizers (co_owner → co_host), pointing at organizers.
ALTER TABLE "event_owners" RENAME TO "event_organizers";
--> statement-breakpoint
ALTER TABLE "event_organizers" RENAME COLUMN "publisher_id" TO "organizer_id";
--> statement-breakpoint
ALTER TYPE "public"."event_owner_role" RENAME TO "event_organizer_role";
--> statement-breakpoint
ALTER TYPE "public"."event_organizer_role" RENAME VALUE 'co_owner' TO 'co_host';
--> statement-breakpoint
ALTER TABLE "event_organizers" RENAME CONSTRAINT "event_owners_event_id_publisher_id_pk" TO "event_organizers_event_id_organizer_id_pk";
--> statement-breakpoint
ALTER TABLE "event_organizers" RENAME CONSTRAINT "event_owners_event_id_events_id_fk" TO "event_organizers_event_id_events_id_fk";
--> statement-breakpoint
ALTER INDEX "event_owners_one_creator_per_event" RENAME TO "event_organizers_one_creator_per_event";
--> statement-breakpoint
ALTER TABLE "event_organizers" DROP CONSTRAINT "event_owners_publisher_id_publishers_id_fk";
--> statement-breakpoint
ALTER TABLE "event_organizers" ADD CONSTRAINT "event_organizers_organizer_id_organizers_id_fk" FOREIGN KEY ("organizer_id") REFERENCES "public"."organizers"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint

-- 6. Every other publisher reference points at accounts, with the same onDelete as before.
ALTER TABLE "events" DROP CONSTRAINT "events_created_by_publishers_id_fk";
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_created_by_accounts_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sessions" DROP CONSTRAINT "sessions_publisher_id_publishers_id_fk";
--> statement-breakpoint
ALTER TABLE "sessions" RENAME COLUMN "publisher_id" TO "account_id";
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "magic_link_tokens" DROP CONSTRAINT "magic_link_tokens_publisher_id_publishers_id_fk";
--> statement-breakpoint
ALTER TABLE "magic_link_tokens" RENAME COLUMN "publisher_id" TO "account_id";
--> statement-breakpoint
ALTER TABLE "magic_link_tokens" ADD CONSTRAINT "magic_link_tokens_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "edit_history" DROP CONSTRAINT "edit_history_publisher_id_publishers_id_fk";
--> statement-breakpoint
ALTER TABLE "edit_history" RENAME COLUMN "publisher_id" TO "account_id";
--> statement-breakpoint
ALTER TABLE "edit_history" ADD CONSTRAINT "edit_history_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ingest_sources" DROP CONSTRAINT "ingest_sources_publisher_id_publishers_id_fk";
--> statement-breakpoint
ALTER TABLE "ingest_sources" RENAME COLUMN "publisher_id" TO "account_id";
--> statement-breakpoint
ALTER TABLE "ingest_sources" ADD CONSTRAINT "ingest_sources_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ingest_items" DROP CONSTRAINT "ingest_items_decided_by_publishers_id_fk";
--> statement-breakpoint
ALTER TABLE "ingest_items" ADD CONSTRAINT "ingest_items_decided_by_accounts_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint

-- 7. Edit history entity types: publisher → account, add organizer, drop invite. Postgres can't drop an enum
--    value, so the type is recreated.
CREATE TYPE "public"."edit_history_entity_type_new" AS ENUM('event', 'venue', 'account', 'organizer');
--> statement-breakpoint
ALTER TABLE "edit_history" ALTER COLUMN "entity_type" SET DATA TYPE "public"."edit_history_entity_type_new"
USING (CASE "entity_type"::text WHEN 'publisher' THEN 'account' ELSE "entity_type"::text END)::"public"."edit_history_entity_type_new";
--> statement-breakpoint
DROP TYPE "public"."edit_history_entity_type";
--> statement-breakpoint
ALTER TYPE "public"."edit_history_entity_type_new" RENAME TO "edit_history_entity_type";
--> statement-breakpoint

-- 8. Nothing references publishers any more (no CASCADE, so anything unexpected still pointing at them fails here).
DROP TABLE "invites";
--> statement-breakpoint
DROP TABLE "publishers";
