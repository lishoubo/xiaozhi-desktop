<script lang="ts">
  import log from 'electron-log/renderer';
  import Router, { replace } from 'svelte-spa-router';
  import { onDestroy } from 'svelte';
  import AppFrame from './components/layout/AppFrame.svelte';
  import AppNotificationCenter from './components/layout/AppNotificationCenter.svelte';
  import StartupAutomationDialog from './components/automation/StartupAutomationDialog.svelte';
  import LoginPage from './pages/LoginPage.svelte';
  import { clearAuthSession, createAuthSession, readAuthSession, type AuthSession } from './auth';
  import { routes } from './routes';

  let session = $state<AuthSession | null>(readAuthSession());
  const sessionTimer = window.setInterval(() => {
    if (session && !readAuthSession()) session = null;
  }, 60_000);
  const logout = (): void => {
    clearAuthSession();
    session = null;
    log.info('User session cleared');
  };
  const login = async (phone: string): Promise<void> => {
    await replace('/');
    session = createAuthSession(phone);
    log.info('User session created');
  };
  window.addEventListener('hotel-butler:logout', logout);
  onDestroy(() => {
    window.clearInterval(sessionTimer);
    window.removeEventListener('hotel-butler:logout', logout);
  });
</script>

{#if session}
  <StartupAutomationDialog />
  <AppFrame>
    <Router {routes} />
  </AppFrame>
{:else}
  <AppNotificationCenter />
  <LoginPage onLogin={login} />
{/if}
