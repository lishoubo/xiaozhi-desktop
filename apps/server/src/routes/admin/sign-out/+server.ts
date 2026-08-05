import { redirect } from '@sveltejs/kit';
import { auth } from '$lib/server/auth';
import { requireAdministrator } from '$lib/server/admin-access';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	requireAdministrator(event.locals.user, event.locals.requestId);
	await auth.api.signOut({ headers: event.request.headers });
	redirect(303, '/login');
};
