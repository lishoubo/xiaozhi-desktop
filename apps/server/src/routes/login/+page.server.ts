import { APIError } from 'better-auth/api';
import { fail, redirect } from '@sveltejs/kit';
import { auth } from '$lib/server/auth';
import { isAdministrator } from '$lib/server/admin-access';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	if (isAdministrator(locals.user)) redirect(302, '/admin');
};

export const actions: Actions = {
	signIn: async (event) => {
		const formData = await event.request.formData();
		const username = formData.get('username')?.toString().trim() ?? '';
		const password = formData.get('password')?.toString() ?? '';
		if (!username || !password) return fail(400, { message: '请输入用户名和密码', username });

		try {
			await auth.api.signInUsername({
				body: { password, username },
				headers: event.request.headers
			});
		} catch (error) {
			const message =
				error instanceof APIError && error.statusCode < 500
					? '用户名或密码错误'
					: '登录失败，请稍后重试';
			return fail(400, { message, username });
		}
		redirect(303, '/admin');
	}
};
