import { env } from '$env/dynamic/private';
import { betterAuth } from 'better-auth/minimal';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { getRequestEvent } from '$app/server';
import { db } from '$lib/server/db';
import { regularUser, superAdmin, ac } from './permissions';
import { admin, phoneNumber, username } from 'better-auth/plugins';

const localPhoneOtpCode =
	env.LOCAL_PHONE_OTP_CODE ?? (env.NODE_ENV === 'production' ? undefined : '123456');

export const auth = betterAuth({
	baseURL: env.ORIGIN,
	secret: env.BETTER_AUTH_SECRET,
	database: drizzleAdapter(db, { provider: 'pg' }),
	emailAndPassword: { disableSignUp: true, enabled: true },
	plugins: [
		admin({
			ac,
			adminRoles: ['superAdmin'],
			defaultRole: 'user',
			roles: {
				user: regularUser,
				superAdmin
			}
		}),
		username(),
		phoneNumber({
			sendOTP: () => {
				if (localPhoneOtpCode) return;
				throw new Error('SMS provider is not configured');
			},
			verifyOTP: localPhoneOtpCode ? ({ code }) => code === localPhoneOtpCode : undefined,
			signUpOnVerification: {
				getTempEmail: (phone) => `${phone.replace(/\D/g, '')}@phone.invalid`,
				getTempName: (phone) => phone
			}
		}),
		sveltekitCookies(getRequestEvent) // make sure this is the last plugin in the array
	]
});
