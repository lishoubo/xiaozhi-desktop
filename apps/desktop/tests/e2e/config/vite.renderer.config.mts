import { mergeConfig } from 'vite';
import rendererConfig from '../../../vite.renderer.config.mts';

export default mergeConfig(rendererConfig, {
  base: './',
  build: {
    outDir: '.e2e/renderer/main_window',
    emptyOutDir: true,
  },
});
