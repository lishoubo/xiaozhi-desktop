import { getDashboardData } from '$lib/server/dashboard';
import { requireAdministrator } from '$lib/server/admin-access';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	requireAdministrator(locals.user, locals.requestId);
	return getDashboardData();
};
