import { defineConfig } from 'vite';
import { appEnvDefine } from './vite-plugins/app-env';
import { authVariantDefine } from './vite-plugins/auth-variant';

// https://vitejs.dev/config
export default defineConfig({
  plugins: [appEnvDefine(), authVariantDefine()],
});
