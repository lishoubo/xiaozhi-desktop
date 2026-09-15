<script lang="ts">
  import log from 'electron-log/renderer';
  import Router, { replace } from 'svelte-spa-router';
  import { onDestroy } from 'svelte';
  import AppFrame from './components/layout/AppFrame.svelte';
  import AppNotificationCenter from './components/layout/AppNotificationCenter.svelte';
  import StaffLoginPage from './pages/StaffLoginPage.svelte';
  import { clearStaffSession, setStaffSession, type StaffSession } from './staff-auth';
  import { setGreetingIdentity } from './session-greeting.svelte';
  import { showAppNotification } from './notifications';
  import { routes } from './routes';

  type Session = StaffSession;

  let session = $state<Session | null>(null);
  let restoringSession = $state(true);

  // 会话是所有登录变体的共同出口，欢迎语的身份就跟着它走——登录、恢复、登出
  // 三条路径各自维护一遍容易漏。
  $effect(() => {
    setGreetingIdentity(session && { username: session.username, fullName: session.fullName });
  });

  const clearSession = (): void => {
    clearStaffSession();
  };

  const restoreSession = async (): Promise<void> => {
    try {
      const restored = await window.hotelButler.staffAuth.currentSession();
      session = restored;
      if (restored) setStaffSession(restored);
      else clearStaffSession();
    } catch {
      clearSession();
      session = null;
    } finally {
      restoringSession = false;
    }
  };

  const logout = async (): Promise<void> => {
    try {
      await window.hotelButler.staffAuth.logout();
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
  const handleLogout = (): void => void logout();
  window.addEventListener('hotel-butler:logout', handleLogout);
  void restoreSession();

  /**
   * 更新已在后台下载完毕，退出应用时自动安装。
   *
   * `durationMs: 0` 让它常驻不自动消失——这条提示错过了就没有第二次，用户得知道
   * 为什么下次打开界面变了。没有"立即重启"按钮：安装发生在自然退出时，不打断
   * 用户手上的事。
   */
  const unsubscribeUpdateReady = window.hotelButler.updater.onUpdateReady(() => {
    log.info('Update downloaded; will install on quit');
    showAppNotification({
      id: 'updater:update-ready',
      title: '新版本已就绪',
      message: '下次退出应用时自动更新。',
      tone: 'default',
      durationMs: 0,
    });
  });

  onDestroy(() => {
    window.removeEventListener('hotel-butler:logout', handleLogout);
    unsubscribeUpdateReady();
  });
</script>

{#if restoringSession}
  <main class="grid h-full place-items-center bg-background" aria-label="正在验证登录状态">
    <p class="text-sm text-muted-foreground">正在验证登录状态…</p>
  </main>
{:else if session}
  <AppFrame {session}>
    <Router {routes} />
  </AppFrame>
{:else}
  <AppNotificationCenter />
  <StaffLoginPage onLogin={loginWithStaff} />
{/if}
