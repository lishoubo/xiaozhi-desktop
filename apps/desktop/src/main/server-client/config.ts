export function resolveServerOrigin(environment: NodeJS.ProcessEnv): string {
  const configuredUrl = environment.HOTEL_BUTLER_SERVER_URL ?? __SERVER_ORIGIN__;
  const url = new URL(configuredUrl);

  if (url.protocol !== 'https:') {
    throw new Error('Desktop server URL must use HTTPS');
  }

  return url.origin;
}
