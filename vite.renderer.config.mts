import { defineConfig } from 'vite';
// The legacy CommonJS ESLint resolver cannot inspect this ESM-only package.
// eslint-disable-next-line import/no-unresolved
import { svelte } from '@sveltejs/vite-plugin-svelte';

// https://vitejs.dev/config
export default defineConfig({
  plugins: [svelte()],
});
