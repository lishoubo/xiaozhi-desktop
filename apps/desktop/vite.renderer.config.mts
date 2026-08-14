import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
// The legacy CommonJS ESLint resolver cannot inspect this ESM-only package.
// eslint-disable-next-line import/no-unresolved
import { svelte } from '@sveltejs/vite-plugin-svelte';
// eslint-disable-next-line import/no-unresolved
import tailwindcss from '@tailwindcss/vite';
import { authVariantDefine } from './vite-plugins/auth-variant';

const certificateDirectory = process.env.LOCAL_HTTPS_CERT_DIR
  ? path.resolve(process.env.LOCAL_HTTPS_CERT_DIR)
  : fileURLToPath(new URL('../server/.cert', import.meta.url));

// https://vitejs.dev/config
export default defineConfig({
  plugins: [authVariantDefine(), tailwindcss(), svelte()],
  server: {
    host: 'localhost',
    port: 5174,
    strictPort: true,
    https: {
      cert: readFileSync(path.join(certificateDirectory, 'cert.pem')),
      key: readFileSync(path.join(certificateDirectory, 'dev.pem')),
    },
  },
  resolve: {
    // Workspace packages and renderer libraries must share the renderer's initialized Svelte
    // runtime. A second runtime can fail while Vite replaces a component during development HMR.
    dedupe: ['svelte'],
    alias: {
      $lib: path.resolve('./src/renderer'),
    },
  },
});
