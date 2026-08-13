import type { Plugin } from 'vite';

const DEFAULT_SERVER_ORIGIN = 'https://localhost:5173';

export function resolveServerOriginForBuild(environment: NodeJS.ProcessEnv = process.env): string {
  const raw = environment.HOTEL_BUTLER_SERVER_URL?.trim() || DEFAULT_SERVER_ORIGIN;
  const url = new URL(raw);
  if (url.protocol !== 'https:') throw new Error('HOTEL_BUTLER_SERVER_URL must use HTTPS');
  return url.origin;
}

export function serverOriginDefine(): Plugin {
  const origin = resolveServerOriginForBuild();
  return {
    name: 'hotel-butler-server-origin',
    config: () => ({ define: { __SERVER_ORIGIN__: JSON.stringify(origin) } }),
  };
}
