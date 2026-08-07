export function resolveRendererDevServerUrl(forgeDevServerUrl: string): string {
  const url = new URL(forgeDevServerUrl);

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Unsupported renderer development server protocol: ${url.protocol}`);
  }

  url.protocol = 'https:';
  return url.href;
}
