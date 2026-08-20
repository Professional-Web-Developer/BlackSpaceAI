-- Adds the agent profile that owns a conversation and each recorded run.
--
-- Hand-edited from the generated migration: a bare `ADD COLUMN ... NOT NULL`
-- fails on a table that already has rows. Adding the column with a default
-- backfills existing rows, and dropping the default afterwards leaves the
-- column matching the schema (not null, no default) for future inserts.
ALTER TABLE "agent_runs" ADD COLUMN "agent_id" text DEFAULT 'general' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runs" ALTER COLUMN "agent_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "agent_id" text DEFAULT 'general' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversations" ALTER COLUMN "agent_id" DROP DEFAULT;
