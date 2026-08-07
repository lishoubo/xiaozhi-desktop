CREATE TABLE "desktop_session" (
	"id" text PRIMARY KEY NOT NULL,
	"token_digest" text NOT NULL,
	"employee_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "desktop_session_token_digest_unique" UNIQUE("token_digest")
);
--> statement-breakpoint
CREATE INDEX "desktopSession_employeeId_idx" ON "desktop_session" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "desktopSession_expiresAt_idx" ON "desktop_session" USING btree ("expires_at");