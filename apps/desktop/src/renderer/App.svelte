<script lang="ts">
  import log from 'electron-log/renderer';
  import Router, { replace } from 'svelte-spa-router';
  import { onDestroy } from 'svelte';
  import AppFrame from './components/layout/AppFrame.svelte';
  import AppNotificationCenter from './components/layout/AppNotificationCenter.svelte';
  import LoginPage from './pages/LoginPage.svelte';
  import StaffLoginPage from './pages/StaffLoginPage.svelte';
  import { clearAuthSession, setAuthSession, type AuthSession } from './auth';
  import { clearStaffSession, setStaffSession, type StaffSession } from './staff-auth';
  import { setGreetingIdentity } from './session-greeting.svelte';
  import { IS_STAFF_AUTH } from '../shared/auth-variant';
  import { routes } from './routes';

  type Session = StaffSession | AuthSession;

  let session = $state<Session | null>(null);
  let restoringSession = $state(true);

  // 会话是所有登录变体的共同出口，欢迎语的身份就跟着它走——登录、恢复、登出
  // 三条路径各自维护一遍容易漏。
  $effect(() => {
    setGreetingIdentity(session && { username: session.username, fullName: session.fullName });
  });

  const clearSession = (): void => {
    if (IS_STAFF_AUTH) clearStaffSession();
    else clearAuthSession();
  };

  const restoreSession = async (): Promise<void> => {
    try {
      if (IS_STAFF_AUTH) {
        const restored = await window.hotelButler.staffAuth.currentSession();
        session = restored;
        if (restored) setStaffSession(restored);
        else clearStaffSession();
      } else {
        const restored = await window.hotelButler.auth.currentSession();
        session = restored;
        if (restored) setAuthSession(restored);
        else clearAuthSession();
      }
    } catch {
      clearSession();
      session = null;
    } finally {
      restoringSession = false;
    }
  };

  const logout = async (): Promise<void> => {
    try {
      if (IS_STAFF_AUTH) await window.hotelButler.staffAuth.logout();
      else await window.hotelButler.auth.logout();
    } catch {
      log.warn('Remote user session could not be revoked');
    } finally {
      clearSession();
      session = null;
      log.info('User session cleared');
    }
  };
  const loginWithStaff = async (employee: StaffSession): Promise<void> => {
    await replace('/');
    setStaffSession(employee);
    session = employee;
    log.info('User session created');
  };
  const loginWithPhone = async (employee: AuthSession): Promise<void> => {
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
  <AppFrame>
    <Router {routes} />
  </AppFrame>
{:else}
  <AppNotificationCenter />
  {#if IS_STAFF_AUTH}
    <StaffLoginPage onLogin={loginWithStaff} />
  {:else}
    <LoginPage onLogin={loginWithPhone} />
  {/if}
{/if}
