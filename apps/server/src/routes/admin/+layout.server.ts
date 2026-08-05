import { requireAdministrator } from '$lib/server/admin-access';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => {
	const administrator = requireAdministrator(locals.user, locals.requestId);
	return {
		administrator: {
			name: administrator.name,
			username: administrator.username
		}
	};
};
