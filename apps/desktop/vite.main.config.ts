import { defineConfig } from 'vite';
import { appEnvDefine } from './vite-plugins/app-env';
import { authVariantDefine } from './vite-plugins/auth-variant';
import { rmsOriginDefine } from './vite-plugins/rms-origin';
import { serverOriginDefine } from './vite-plugins/server-origin';

// https://vitejs.dev/config
export default defineConfig({
  plugins: [appEnvDefine(), authVariantDefine(), rmsOriginDefine(), serverOriginDefine()],
  build: {
    rollupOptions: {
      // Keep the native binding on disk so Forge can rebuild and unpack it for Electron.
      external: ['better-sqlite3'],
    },
  },
});
