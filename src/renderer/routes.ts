import type { RouteDefinition } from 'svelte-spa-router';
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
  '*': NotFoundPage,
};
