import { error } from '@sveltejs/kit';

export function isAdministrator(user: App.AuthUser | undefined): boolean {
	return user !== undefined;
}

export function requireAdministrator(
	user: App.AuthUser | undefined,
	requestId: string
): App.AuthUser {
	if (!user) error(401, { message: '请先登录管理后台', requestId });
	return user;
}
