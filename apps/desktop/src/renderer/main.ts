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
import log from 'electron-log/renderer';
import App from './App.svelte';
import { configureRendererLogging } from './logging';
import './styles/global.css';

configureRendererLogging(log, { isDevelopment: import.meta.env.DEV });

const target = document.getElementById('app');

if (!target) {
  throw new Error('Could not find the Svelte mount target');
}

mount(App, { target });
