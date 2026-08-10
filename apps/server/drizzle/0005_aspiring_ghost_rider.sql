CREATE TABLE "agent_conversation" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_employee_id" text NOT NULL,
	"owner_org_id" text NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_memory" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_employee_id" text NOT NULL,
	"owner_org_id" text NOT NULL,
	"key" text NOT NULL,
	"content" text NOT NULL,
	"importance" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_message" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"ui" jsonb,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_run" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"owner_employee_id" text NOT NULL,
	"client_request_id" text NOT NULL,
	"user_message_id" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agent_run_event" (
	"sequence" serial PRIMARY KEY NOT NULL,
	"id" text NOT NULL,
	"run_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"owner_employee_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "agent_run_event_id_unique" UNIQUE("id")
);
--> statement-breakpoint
ALTER TABLE "agent_message" ADD CONSTRAINT "agent_message_conversation_id_agent_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."agent_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_conversation_id_agent_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."agent_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_user_message_id_agent_message_id_fk" FOREIGN KEY ("user_message_id") REFERENCES "public"."agent_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run_event" ADD CONSTRAINT "agent_run_event_run_id_agent_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run_event" ADD CONSTRAINT "agent_run_event_conversation_id_agent_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."agent_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agentConversation_owner_updated_idx" ON "agent_conversation" USING btree ("owner_employee_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agentMemory_owner_key_uidx" ON "agent_memory" USING btree ("owner_employee_id","key");--> statement-breakpoint
CREATE INDEX "agentMemory_owner_updated_idx" ON "agent_memory" USING btree ("owner_employee_id","updated_at");--> statement-breakpoint
CREATE INDEX "agentMessage_conversation_created_idx" ON "agent_message" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agentRun_owner_clientRequest_uidx" ON "agent_run" USING btree ("owner_employee_id","client_request_id");--> statement-breakpoint
CREATE INDEX "agentRun_conversation_created_idx" ON "agent_run" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "agentRunEvent_run_sequence_idx" ON "agent_run_event" USING btree ("run_id","sequence");