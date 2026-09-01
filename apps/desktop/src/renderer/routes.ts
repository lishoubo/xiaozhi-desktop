import type { RouteDefinition } from 'svelte-spa-router';
// The legacy CommonJS ESLint resolver cannot inspect this package export.
// eslint-disable-next-line import/no-unresolved
import BrowserPage from './pages/BrowserPage.svelte';
import CalendarPage from './pages/CalendarPage.svelte';
import NotFoundPage from './pages/NotFoundPage.svelte';
import SettingsPage from './pages/SettingsPage.svelte';
import StaffProfilePage from './pages/StaffProfilePage.svelte';
import AgentPage from './pages/AgentPage.svelte';
import HotelManagementPage from './pages/HotelManagementPage.svelte';

export const routes: RouteDefinition = {
  '/': BrowserPage,
  '/settings': SettingsPage,
  '/profile': StaffProfilePage,
  '/agent': AgentPage,
  '/calendar': CalendarPage,
  '/hotels': HotelManagementPage,
  '*': NotFoundPage,
};
