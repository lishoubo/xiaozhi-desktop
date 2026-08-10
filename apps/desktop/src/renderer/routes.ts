import type { RouteDefinition } from 'svelte-spa-router';
// The legacy CommonJS ESLint resolver cannot inspect this package export.
// eslint-disable-next-line import/no-unresolved
import BrowserPage from './pages/BrowserPage.svelte';
import CalendarPage from './pages/CalendarPage.svelte';
import NotFoundPage from './pages/NotFoundPage.svelte';
import SettingsPage from './pages/SettingsPage.svelte';
import ProfilePage from './pages/ProfilePage.svelte';
import StaffProfilePage from './pages/StaffProfilePage.svelte';
import AgentPage from './pages/AgentPage.svelte';
import HotelManagementPage from './pages/HotelManagementPage.svelte';
import { IS_STAFF_AUTH } from '../shared/auth-variant';

export const routes: RouteDefinition = {
  '/': BrowserPage,
  '/settings': SettingsPage,
  // 用户中心跟着登录变体走：两套身份的字段不同，同一个页面渲染不了。
  '/profile': IS_STAFF_AUTH ? StaffProfilePage : ProfilePage,
  '/agent': AgentPage,
  '/calendar': CalendarPage,
  '/hotels': HotelManagementPage,
  '*': NotFoundPage,
};
