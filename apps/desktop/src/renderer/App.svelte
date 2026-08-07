<script lang="ts">
  import log from 'electron-log/renderer';
  import Router, { replace } from 'svelte-spa-router';
  import { onDestroy } from 'svelte';
  import AppFrame from './components/layout/AppFrame.svelte';
  import AppNotificationCenter from './components/layout/AppNotificationCenter.svelte';
  import StartupAutomationDialog from './components/automation/StartupAutomationDialog.svelte';
  import LoginPage from './pages/LoginPage.svelte';
  import { clearAuthSession, setAuthSession, type AuthSession } from './auth';
  import { isFeatureOff } from './version-features';
  import { routes } from './routes';

  // 'auth' 特性关闭时跳过远端手机验证码登录门禁，用本地假身份直接进入
  // 主界面。仅用于本地不起 server 时的开发联调，见 version-features.ts。
  const skipAuth = isFeatureOff('auth');
  const DEV_BYPASS_SESSION: AuthSession = {
    id: '0',
    orgId: '0',
    username: 'lishoubo-dev',
    fullName: '本地开发（跳过登录）',
    phone: '13800138000',
    roleCode: 'FRONT_DESK',
  };

  let session = $state<AuthSession | null>(skipAuth ? DEV_BYPASS_SESSION : null);
  let restoringSession = $state(!skipAuth);

  const restoreSession = async (): Promise<void> => {
    if (skipAuth) {
      setAuthSession(DEV_BYPASS_SESSION);
      return;
    }
    try {
      session = await window.hotelButler.auth.currentSession();
      if (session) setAuthSession(session);
      else clearAuthSession();
    } catch {
      clearAuthSession();
      session = null;
    } finally {
      restoringSession = false;
    }
  };

  const logout = async (): Promise<void> => {
    try {
      await window.hotelButler.auth.logout();
    } catch {
      log.warn('Remote user session could not be revoked');
    } finally {
      clearAuthSession();
      session = null;
      log.info('User session cleared');
    }
  };
  const login = async (employee: AuthSession): Promise<void> => {
    await replace('/');
    setAuthSession(employee);
    session = employee;
    log.info('User session created');
  };
  const handleLogout = (): void => void logout();
  window.addEventListener('hotel-butler:logout', handleLogout);
  void restoreSession();
  onDestroy(() => {
    window.removeEventListener('hotel-butler:logout', handleLogout);
  });
</script>

{#if restoringSession}
  <main class="grid h-full place-items-center bg-background" aria-label="正在验证登录状态">
    <p class="text-sm text-muted-foreground">正在验证登录状态…</p>
  </main>
{:else if session}
  <StartupAutomationDialog />
  <AppFrame>
    <Router {routes} />
  </AppFrame>
{:else}
  <AppNotificationCenter />
  <LoginPage onLogin={login} />
{/if}
