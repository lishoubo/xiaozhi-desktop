import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    rollupOptions: {
      // Keep the native binding on disk so Forge can rebuild and unpack it for Electron.
      external: ['better-sqlite3'],
    },
  },
});
