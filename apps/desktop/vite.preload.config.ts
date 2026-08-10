import { defineConfig } from 'vite';
import { authVariantDefine } from './vite-plugins/auth-variant';

// https://vitejs.dev/config
export default defineConfig({
  plugins: [authVariantDefine()],
});
