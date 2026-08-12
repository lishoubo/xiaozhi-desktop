ALTER TABLE "agent_conversation" ADD COLUMN "context_summary" text;--> statement-breakpoint
ALTER TABLE "agent_conversation" ADD COLUMN "summarized_through_message_id" text;--> statement-breakpoint
ALTER TABLE "agent_conversation" ADD COLUMN "summary_updated_at" timestamp with time zone;