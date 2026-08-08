import { defineConfig } from 'vite';
import { authVariantDefine } from './vite-plugins/auth-variant';

// https://vitejs.dev/config
export default defineConfig({
  plugins: [authVariantDefine()],
  build: {
    rollupOptions: {
      // Keep the native binding on disk so Forge can rebuild and unpack it for Electron.
      external: ['better-sqlite3'],
    },
  },
});
