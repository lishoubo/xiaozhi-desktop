import path from 'node:path';
import { defineConfig } from 'vite';
// The legacy CommonJS ESLint resolver cannot inspect this ESM-only package.
// eslint-disable-next-line import/no-unresolved
import { svelte } from '@sveltejs/vite-plugin-svelte';
// eslint-disable-next-line import/no-unresolved
import tailwindcss from '@tailwindcss/vite';

// https://vitejs.dev/config
export default defineConfig({
  plugins: [tailwindcss(), svelte()],
  server: {
    // Keep the development server local; Electron is its only intended client.
    host: '127.0.0.1',
    strictPort: true,
  },
  resolve: {
    alias: {
      $lib: path.resolve('./src/renderer'),
    },
  },
});
