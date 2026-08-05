import type { User, Session } from 'better-auth';
import type { RequestLogger } from '$lib/server/logging/request-logging';

// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		interface Locals {
			logger: RequestLogger;
			requestId: string;
			user?: User;
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
