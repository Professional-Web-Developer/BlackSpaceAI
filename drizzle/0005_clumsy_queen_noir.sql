ALTER TABLE "agent_runs" ADD COLUMN "cache_read_tokens" integer;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "cache_write_tokens" integer;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "cost_nanos" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "monthly_limit_nanos" bigint;--> statement-breakpoint
CREATE INDEX "agent_runs_created_at_idx" ON "agent_runs" USING btree ("created_at");