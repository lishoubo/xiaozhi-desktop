CREATE TABLE "agent_business_execution" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"trigger_user_message_id" text NOT NULL,
	"owner_employee_id" text NOT NULL,
	"owner_org_id" text NOT NULL,
	"route_kind" text NOT NULL,
	"intent" text,
	"status" text NOT NULL,
	"state" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agent_business_execution_event" (
	"sequence" serial PRIMARY KEY NOT NULL,
	"id" text NOT NULL,
	"business_execution_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"owner_employee_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "agent_business_execution_event_id_unique" UNIQUE("id")
);
--> statement-breakpoint
ALTER TABLE "agent_message" ADD COLUMN "business_execution_id" text;--> statement-breakpoint
ALTER TABLE "agent_run" ADD COLUMN "business_execution_id" text;--> statement-breakpoint
ALTER TABLE "agent_business_execution" ADD CONSTRAINT "agent_business_execution_conversation_id_agent_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."agent_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_business_execution" ADD CONSTRAINT "agent_business_execution_trigger_user_message_id_agent_message_id_fk" FOREIGN KEY ("trigger_user_message_id") REFERENCES "public"."agent_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_business_execution_event" ADD CONSTRAINT "agent_business_execution_event_business_execution_id_agent_business_execution_id_fk" FOREIGN KEY ("business_execution_id") REFERENCES "public"."agent_business_execution"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_business_execution_event" ADD CONSTRAINT "agent_business_execution_event_conversation_id_agent_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."agent_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agentBusinessExecution_conversation_active_uidx" ON "agent_business_execution" USING btree ("conversation_id") WHERE "agent_business_execution"."status" not in ('completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE INDEX "agentBusinessExecution_owner_updated_idx" ON "agent_business_execution" USING btree ("owner_employee_id","updated_at");--> statement-breakpoint
CREATE INDEX "agentBusinessExecutionEvent_execution_sequence_idx" ON "agent_business_execution_event" USING btree ("business_execution_id","sequence");--> statement-breakpoint
ALTER TABLE "agent_message" ADD CONSTRAINT "agent_message_business_execution_id_agent_business_execution_id_fk" FOREIGN KEY ("business_execution_id") REFERENCES "public"."agent_business_execution"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_business_execution_id_agent_business_execution_id_fk" FOREIGN KEY ("business_execution_id") REFERENCES "public"."agent_business_execution"("id") ON DELETE set null ON UPDATE no action;