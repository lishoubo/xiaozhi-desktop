export function isDesktopTrpcPath(pathname: string): boolean {
	return pathname === '/api/trpc' || pathname.startsWith('/api/trpc/');
}
