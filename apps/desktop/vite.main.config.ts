import { defineConfig } from 'vite';
import { appEnvDefine } from './vite-plugins/app-env';
import { rmsOriginDefine } from './vite-plugins/rms-origin';
import { rmsWebOriginDefine } from './vite-plugins/rms-web-origin';
import { sentryDsnDefine } from './vite-plugins/sentry-dsn';
import { serverOriginDefine } from './vite-plugins/server-origin';
import { updateFeedDefine } from './vite-plugins/update-feed';

// https://vitejs.dev/config
export default defineConfig({
  plugins: [
    appEnvDefine(),
    rmsOriginDefine(),
    rmsWebOriginDefine(),
    serverOriginDefine(),
    sentryDsnDefine(),
    updateFeedDefine(),
  ],
  build: {
    rollupOptions: {
      // Keep the native binding on disk so Forge can rebuild and unpack it for Electron.
      external: ['better-sqlite3'],
    },
  },
});
