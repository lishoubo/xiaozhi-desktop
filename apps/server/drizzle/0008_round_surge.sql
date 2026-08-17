ALTER TABLE "agent_run" ADD COLUMN "retry_of_run_id" text;--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_retry_of_run_id_agent_run_id_fk" FOREIGN KEY ("retry_of_run_id") REFERENCES "public"."agent_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agentRun_retry_of_idx" ON "agent_run" USING btree ("retry_of_run_id");