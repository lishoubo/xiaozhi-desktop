import { fail } from '@sveltejs/kit';
import { requireAdministrator } from '$lib/server/admin-access';
import {
	listDesktopUsers,
	parseDesktopUserQuery,
	setDesktopUserStatus
} from '$lib/server/desktop-user-management';
import type { DesktopUserStatus } from '$lib/server/db/desktop-user.schema';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	requireAdministrator(locals.user, locals.requestId);
	return listDesktopUsers(parseDesktopUserQuery(url.searchParams));
};

function formValue(formData: FormData, name: string): string {
	return formData.get(name)?.toString().trim() ?? '';
}

export const actions: Actions = {
	setStatus: async (event) => {
		requireAdministrator(event.locals.user, event.locals.requestId);
		const formData = await event.request.formData();
		const userId = formValue(formData, 'userId');
		const status = formValue(formData, 'status');
		if (!userId || (status !== 'active' && status !== 'disabled')) {
			return fail(400, { message: '用户状态参数无效' });
		}

		const updated = await setDesktopUserStatus(userId, status as DesktopUserStatus);
		if (!updated) return fail(404, { message: '桌面用户不存在或已被删除' });
		return { message: status === 'disabled' ? '桌面用户已停用' : '桌面用户已恢复' };
	}
};
