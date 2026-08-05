import type { User, Session } from 'better-auth';
import type { RequestLogger } from '$lib/server/logging/request-logging';

// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		type AuthUser = User & {
			displayUsername?: string | null;
			username?: string | null;
		};

		interface Locals {
			logger: RequestLogger;
			requestId: string;
			user?: AuthUser;
			session?: Session;
		}

		interface Error {
			message: string;
			requestId: string;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
