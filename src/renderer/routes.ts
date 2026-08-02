import type { RouteDefinition } from 'svelte-spa-router';
// The legacy CommonJS ESLint resolver cannot inspect this package export.
// eslint-disable-next-line import/no-unresolved
import { wrap } from 'svelte-spa-router/wrap';
import BrowserPage from './pages/BrowserPage.svelte';
import NotFoundPage from './pages/NotFoundPage.svelte';
import SettingsPage from './pages/SettingsPage.svelte';
import ProfilePage from './pages/ProfilePage.svelte';
import AgentPage from './pages/AgentPage.svelte';

export const routes: RouteDefinition = {
  '/': BrowserPage,
  '/settings': SettingsPage,
  '/profile': ProfilePage,
  '/agent': AgentPage,
  '/calendar': wrap({ asyncComponent: () => import('./pages/CalendarPage.svelte') }),
  '*': NotFoundPage,
};
