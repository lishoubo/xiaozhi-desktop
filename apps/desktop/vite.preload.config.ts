import { defineConfig } from 'vite';
import { appEnvDefine } from './vite-plugins/app-env';

// https://vitejs.dev/config
export default defineConfig({
  plugins: [appEnvDefine()],
});
