ALTER TYPE "public"."edit_history_action" ADD VALUE 'deleted';--> statement-breakpoint
ALTER TABLE "publishers" ADD COLUMN "is_publisher" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "publishers" ADD COLUMN "is_scout" boolean DEFAULT false NOT NULL;