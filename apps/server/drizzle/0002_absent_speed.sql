ALTER TABLE "admin_session" DROP COLUMN "impersonated_by";--> statement-breakpoint
ALTER TABLE "admin_user" DROP COLUMN "role";--> statement-breakpoint
ALTER TABLE "admin_user" DROP COLUMN "banned";--> statement-breakpoint
ALTER TABLE "admin_user" DROP COLUMN "ban_reason";--> statement-breakpoint
ALTER TABLE "admin_user" DROP COLUMN "ban_expires";