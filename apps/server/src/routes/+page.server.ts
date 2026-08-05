import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	redirect(302, locals.user?.role?.split(',').includes('superAdmin') ? '/admin/users' : '/login');
};
