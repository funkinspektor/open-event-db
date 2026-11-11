CREATE TYPE "public"."magic_link_kind" AS ENUM('login', 'signup', 'email_change');--> statement-breakpoint
CREATE TABLE "event_interests" (
	"account_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_interests_account_id_event_id_pk" PRIMARY KEY("account_id","event_id")
);
--> statement-breakpoint
ALTER TABLE "magic_link_tokens" ALTER COLUMN "account_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "onboarded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "terms_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "calendar_token" text;--> statement-breakpoint
ALTER TABLE "magic_link_tokens" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "magic_link_tokens" ADD COLUMN "kind" "magic_link_kind" DEFAULT 'login' NOT NULL;--> statement-breakpoint
ALTER TABLE "magic_link_tokens" ADD COLUMN "return_to" text;--> statement-breakpoint
ALTER TABLE "magic_link_tokens" ADD COLUMN "new_email" text;--> statement-breakpoint
ALTER TABLE "magic_link_tokens" ADD COLUMN "request_ip" text;--> statement-breakpoint
ALTER TABLE "magic_link_tokens" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
-- Every account that exists before sign-up counts as onboarded.
UPDATE "accounts" SET "onboarded_at" = "created_at";--> statement-breakpoint
-- Tokens without an account cannot exist before this migration (account_id was NOT NULL); the delete is a safeguard.
DELETE FROM "magic_link_tokens" WHERE "account_id" IS NULL;--> statement-breakpoint
UPDATE "magic_link_tokens" t SET "email" = a."email" FROM "accounts" a WHERE a."id" = t."account_id";--> statement-breakpoint
ALTER TABLE "magic_link_tokens" ALTER COLUMN "email" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "event_interests" ADD CONSTRAINT "event_interests_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_interests" ADD CONSTRAINT "event_interests_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_interests_event_idx" ON "event_interests" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "magic_link_tokens_kind_ip_created_idx" ON "magic_link_tokens" USING btree ("kind","request_ip","created_at");--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_calendar_token_unique" UNIQUE("calendar_token");