import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
// The legacy CommonJS ESLint resolver cannot inspect this ESM-only package.
// eslint-disable-next-line import/no-unresolved
import { svelte } from '@sveltejs/vite-plugin-svelte';
// eslint-disable-next-line import/no-unresolved
import tailwindcss from '@tailwindcss/vite';
import { appEnvDefine } from './vite-plugins/app-env';
import { authVariantDefine } from './vite-plugins/auth-variant';
import { sentryDsnDefine } from './vite-plugins/sentry-dsn';

const certificateDirectory = process.env.LOCAL_HTTPS_CERT_DIR
  ? path.resolve(process.env.LOCAL_HTTPS_CERT_DIR)
  : fileURLToPath(new URL('../server/.cert', import.meta.url));

/**
 * 本地开发服务器的证书由 `npm run https:setup` 生成，**只有 `vite dev` 用得到**。
 *
 * 必须惰性读取：配置对象是模块顶层求值的，直接在 `server.https` 里 `readFileSync`
 * 会让**打包**也要求证书存在——而打包机（CI、干净检出）上没有也不该有这份开发证书，
 * 表现为 `vite build` 在加载配置阶段就 ENOENT，跟渲染进程构建本身毫无关系。
 */
function developmentServerHttps() {
  return {
    cert: readFileSync(path.join(certificateDirectory, 'cert.pem')),
    key: readFileSync(path.join(certificateDirectory, 'dev.pem')),
  };
}

// https://vitejs.dev/config
export default defineConfig(({ command }) => ({
  plugins: [appEnvDefine(), authVariantDefine(), sentryDsnDefine(), tailwindcss(), svelte()],
  server: {
    host: 'localhost',
    port: 5174,
    strictPort: true,
    ...(command === 'serve' ? { https: developmentServerHttps() } : {}),
  },
  resolve: {
    // Workspace packages and renderer libraries must share the renderer's initialized Svelte
    // runtime. A second runtime can fail while Vite replaces a component during development HMR.
    dedupe: ['svelte'],
    alias: {
      $lib: path.resolve('./src/renderer'),
    },
  },
}));
