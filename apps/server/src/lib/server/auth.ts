import { env } from '$env/dynamic/private';
import { betterAuth } from 'better-auth/minimal';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { getRequestEvent } from '$app/server';
import { db } from '$lib/server/db';
import { username } from 'better-auth/plugins';

export const auth = betterAuth({
	baseURL: env.ORIGIN,
	secret: env.BETTER_AUTH_SECRET,
	database: drizzleAdapter(db, { provider: 'pg' }),
	user: { modelName: 'adminUser' },
	session: { modelName: 'adminSession' },
	account: { modelName: 'adminAccount' },
	verification: { modelName: 'adminVerification' },
	emailAndPassword: { disableSignUp: true, enabled: true },
	plugins: [
		username(),
		sveltekitCookies(getRequestEvent) // make sure this is the last plugin in the array
	]
});
