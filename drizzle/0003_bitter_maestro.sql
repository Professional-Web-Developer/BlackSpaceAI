CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
DROP INDEX "conversations_updated_at_idx";--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "user_id" uuid;--> statement-breakpoint
-- Hand-edited from the generated migration.
--
-- The generated statement added user_id as NOT NULL in one step, which fails
-- on any database that already has conversations - and conversations created
-- before authentication existed have no owner to backfill from.
--
-- Rather than dropping that history, orphans are adopted by a placeholder
-- account. Its password hash is deliberately malformed so it can never be
-- signed into; an admin can reassign or delete these threads afterwards. The
-- account is only created when there is actually something to adopt.
DO $$
DECLARE legacy_id uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM "conversations" WHERE "user_id" IS NULL) THEN
    INSERT INTO "users" ("email", "password_hash", "role")
    VALUES ('legacy@blackspace.invalid', 'scrypt$unusable-placeholder', 'member')
    ON CONFLICT ("email") DO NOTHING;

    SELECT "id" INTO legacy_id FROM "users"
    WHERE "email" = 'legacy@blackspace.invalid';

    UPDATE "conversations" SET "user_id" = legacy_id WHERE "user_id" IS NULL;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "conversations" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessions_token_hash_idx" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversations_user_updated_idx" ON "conversations" USING btree ("user_id","updated_at");