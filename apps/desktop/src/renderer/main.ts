/**
 * This file will automatically be loaded by vite and run in the "renderer" context.
 * To learn more about the differences between the "main" and the "renderer" context in
 * Electron, visit:
 *
 * https://electronjs.org/docs/tutorial/process-model
 *
 * Node.js integration stays disabled in renderer processes. Privileged capabilities are
 * exposed through the narrow, context-isolated preload API. See Electron's security guidance:
 *
 * https://electronjs.org/docs/tutorial/security
 */

import { mount } from 'svelte';
import * as Sentry from '@sentry/electron/renderer';
import log from 'electron-log/renderer';
import App from './App.svelte';
import { configureRendererLogging } from './logging';
import './styles/global.css';

configureRendererLogging(log, { isDevelopment: import.meta.env.DEV });

/**
 * 渲染进程上报：配置（DSN、environment、release、脱敏钩子）全部由主进程继承，
 * 这里不重复传——重复传反而会让两端配置有漂移的可能。
 *
 * 主进程没配 DSN 时（dev 环境默认如此），这里初始化后同样不会发出任何东西。
 */
Sentry.init();

const target = document.getElementById('app');

if (!target) {
  throw new Error('Could not find the Svelte mount target');
}

mount(App, { target });
