import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { requireAdministrator } from '$lib/server/admin-access';
import { getVisibleLocalAdminCredentials } from '$lib/server/local-admin-credentials';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => {
	const administrator = requireAdministrator(locals.user, locals.requestId);
	const localAdministrator = getVisibleLocalAdminCredentials(env, dev);
	return {
		administrator: {
			name: administrator.name,
			username: administrator.username,
			isLocal: localAdministrator?.username === administrator.username
		}
	};
};
