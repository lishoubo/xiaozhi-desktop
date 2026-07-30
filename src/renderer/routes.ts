import type { RouteDefinition } from 'svelte-spa-router';
import BrowserPage from './pages/BrowserPage.svelte';
import NotFoundPage from './pages/NotFoundPage.svelte';
import SettingsPage from './pages/SettingsPage.svelte';

export const routes: RouteDefinition = {
  '/': BrowserPage,
  '/settings': SettingsPage,
  '*': NotFoundPage,
};
