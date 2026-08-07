<script lang="ts">
  import log from 'electron-log/renderer';
  import Router, { replace } from 'svelte-spa-router';
  import { onDestroy } from 'svelte';
  import AppFrame from './components/layout/AppFrame.svelte';
  import AppNotificationCenter from './components/layout/AppNotificationCenter.svelte';
  import StartupAutomationDialog from './components/automation/StartupAutomationDialog.svelte';
  import LoginPage from './pages/LoginPage.svelte';
  import { clearAuthSession, setAuthSession, type AuthSession } from './auth';
  import { routes } from './routes';

  let session = $state<AuthSession | null>(null);
  let restoringSession = $state(true);

  const restoreSession = async (): Promise<void> => {
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
