export interface VisibleLocalAdminCredentials {
	password: string;
	username: string;
}

export function getVisibleLocalAdminCredentials(
	environment: NodeJS.ProcessEnv,
	isDevelopment: boolean
): VisibleLocalAdminCredentials | undefined {
	if (!isDevelopment && environment.SHOW_LOCAL_ADMIN_CREDENTIALS !== 'true') return undefined;

	return {
		password: environment.INITIAL_ADMIN_PASSWORD ?? 'admin123',
		username: environment.INITIAL_ADMIN_USERNAME ?? 'admin'
	};
}
