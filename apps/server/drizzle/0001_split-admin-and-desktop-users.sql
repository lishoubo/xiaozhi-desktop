CREATE TABLE "desktop_user" (
	"id" text PRIMARY KEY NOT NULL,
	"phone_number" text NOT NULL,
	"display_name" text,
	"phone_number_verified" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_login_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "desktop_user_phone_number_unique" UNIQUE("phone_number")
);
--> statement-breakpoint
ALTER TABLE "account" RENAME TO "admin_account";--> statement-breakpoint
ALTER TABLE "session" RENAME TO "admin_session";--> statement-breakpoint
ALTER TABLE "user" RENAME TO "admin_user";--> statement-breakpoint
ALTER TABLE "verification" RENAME TO "admin_verification";--> statement-breakpoint
INSERT INTO "desktop_user" (
	"id",
	"phone_number",
	"display_name",
	"phone_number_verified",
	"status",
	"created_at",
	"updated_at"
)
SELECT
	"id",
	"phone_number",
	"name",
	COALESCE("phone_number_verified", false),
	CASE WHEN COALESCE("banned", false) THEN 'disabled' ELSE 'active' END,
	"created_at",
	"updated_at"
FROM "admin_user"
WHERE "phone_number" IS NOT NULL
	AND NOT ('superAdmin' = ANY(string_to_array(COALESCE("role", ''), ',')))
ON CONFLICT ("phone_number") DO NOTHING;--> statement-breakpoint
DELETE FROM "admin_user"
WHERE "phone_number" IS NOT NULL
	AND NOT ('superAdmin' = ANY(string_to_array(COALESCE("role", ''), ',')));--> statement-breakpoint
ALTER TABLE "admin_session" DROP CONSTRAINT "session_token_unique";--> statement-breakpoint
ALTER TABLE "admin_user" DROP CONSTRAINT "user_email_unique";--> statement-breakpoint
ALTER TABLE "admin_user" DROP CONSTRAINT "user_username_unique";--> statement-breakpoint
ALTER TABLE "admin_user" DROP CONSTRAINT "user_phone_number_unique";--> statement-breakpoint
ALTER TABLE "admin_account" DROP CONSTRAINT "account_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "admin_session" DROP CONSTRAINT "session_user_id_user_id_fk";
--> statement-breakpoint
DROP INDEX "account_userId_idx";--> statement-breakpoint
DROP INDEX "session_userId_idx";--> statement-breakpoint
DROP INDEX "verification_identifier_idx";--> statement-breakpoint
CREATE INDEX "desktop_user_status_idx" ON "desktop_user" USING btree ("status");--> statement-breakpoint
CREATE INDEX "desktop_user_created_at_idx" ON "desktop_user" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "admin_account" ADD CONSTRAINT "admin_account_user_id_admin_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."admin_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_session" ADD CONSTRAINT "admin_session_user_id_admin_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."admin_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "adminAccount_userId_idx" ON "admin_account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "adminSession_userId_idx" ON "admin_session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "adminVerification_identifier_idx" ON "admin_verification" USING btree ("identifier");--> statement-breakpoint
ALTER TABLE "admin_user" DROP COLUMN "phone_number";--> statement-breakpoint
ALTER TABLE "admin_user" DROP COLUMN "phone_number_verified";--> statement-breakpoint
ALTER TABLE "admin_session" ADD CONSTRAINT "admin_session_token_unique" UNIQUE("token");--> statement-breakpoint
ALTER TABLE "admin_user" ADD CONSTRAINT "admin_user_email_unique" UNIQUE("email");--> statement-breakpoint
ALTER TABLE "admin_user" ADD CONSTRAINT "admin_user_username_unique" UNIQUE("username");
