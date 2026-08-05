import { APIError } from 'better-auth/api';
import { fail, redirect } from '@sveltejs/kit';
import { auth } from '$lib/server/auth';
import { requireSuperAdmin } from '$lib/server/admin-access';
import {
	listManagedUsers,
	parseManagedUserQuery,
	setManagedUserBanned,
	setManagedUserRole
} from '$lib/server/user-management';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const administrator = requireSuperAdmin(locals.user, locals.requestId);
	return {
		administrator: { id: administrator.id, name: administrator.name },
		...(await listManagedUsers(parseManagedUserQuery(url.searchParams)))
	};
};

function formValue(formData: FormData, name: string): string {
	return formData.get(name)?.toString().trim() ?? '';
}

function actionError(error: unknown) {
	const message =
		error instanceof APIError && error.message ? error.message : '操作失败，请稍后重试';
	return fail(400, { message });
}

export const actions: Actions = {
	setRole: async (event) => {
		const administrator = requireSuperAdmin(event.locals.user, event.locals.requestId);
		const formData = await event.request.formData();
		const userId = formValue(formData, 'userId');
		const role = formValue(formData, 'role');
		if (!userId || (role !== 'user' && role !== 'superAdmin'))
			return fail(400, { message: '角色参数无效' });
		if (userId === administrator.id && role !== 'superAdmin')
			return fail(400, { message: '不能移除自己的超级管理员权限' });
		try {
			await setManagedUserRole(event.request.headers, userId, role);
			return { message: '用户角色已更新' };
		} catch (error) {
			return actionError(error);
		}
	},
	setStatus: async (event) => {
		const administrator = requireSuperAdmin(event.locals.user, event.locals.requestId);
		const formData = await event.request.formData();
		const userId = formValue(formData, 'userId');
		const banned = formValue(formData, 'banned') === 'true';
		if (!userId) return fail(400, { message: '用户参数无效' });
		if (userId === administrator.id && banned) return fail(400, { message: '不能停用自己的账号' });
		try {
			await setManagedUserBanned(event.request.headers, userId, banned);
			return { message: banned ? '用户已停用' : '用户已恢复' };
		} catch (error) {
			return actionError(error);
		}
	},
	signOut: async (event) => {
		await auth.api.signOut({ headers: event.request.headers });
		redirect(303, '/login');
	}
};
