import { error } from '@sveltejs/kit';

export function isSuperAdmin(user: App.AuthUser | undefined): boolean {
	return user?.role?.split(',').includes('superAdmin') ?? false;
}

export function requireSuperAdmin(user: App.AuthUser | undefined, requestId: string): App.AuthUser {
	if (!user) error(401, { message: '请先登录管理后台', requestId });
	if (!isSuperAdmin(user)) error(403, { message: '当前账号没有用户管理权限', requestId });
	return user;
}
