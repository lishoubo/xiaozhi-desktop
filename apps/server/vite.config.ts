import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig(({ command }) => {
	const certificateDirectory = process.env.LOCAL_HTTPS_CERT_DIR ?? path.resolve('.cert');
	const lifecycleEvent = process.env.npm_lifecycle_event;
	const shouldServeHttps =
		command === 'serve' &&
		(Boolean(process.env.LOCAL_HTTPS_CERT_DIR) ||
			lifecycleEvent === 'dev' ||
			lifecycleEvent === 'preview');
	const https = shouldServeHttps
		? {
				cert: readFileSync(path.join(certificateDirectory, 'cert.pem')),
				key: readFileSync(path.join(certificateDirectory, 'dev.pem'))
			}
		: undefined;

	return {
		plugins: [
			tailwindcss(),
			sveltekit({
				compilerOptions: {
					// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
					runes: ({ filename }) =>
						filename.split(/[/\\]/).includes('node_modules') ? undefined : true
				},
				adapter: adapter(),
				typescript: {
					config: (config) => {
						config.include.push('../drizzle.config.ts');
					}
				}
			})
		],
		server: https ? { https } : undefined,
		preview: https ? { https } : undefined,
		test: {
			expect: { requireAssertions: true },
			projects: [
				{
					extends: './vite.config.ts',
					test: {
						name: 'client',
						browser: {
							enabled: true,
							provider: playwright(),
							instances: [{ browser: 'chromium', headless: true }]
						},
						include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
						exclude: ['src/lib/server/**']
					}
				},

				{
					extends: './vite.config.ts',
					test: {
						name: 'server',
						environment: 'node',
						include: ['src/**/*.{test,spec}.{js,ts}'],
						exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
					}
				}
			]
		}
	};
});
