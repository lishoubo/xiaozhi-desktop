<script lang="ts">
  import { onMount } from 'svelte';
  import Bell from '@lucide/svelte/icons/bell';
  import log from 'electron-log/renderer';
  import Cookie from '@lucide/svelte/icons/cookie';
  import MonitorUp from '@lucide/svelte/icons/monitor-up';
  import Settings2 from '@lucide/svelte/icons/settings-2';
  import type { SystemPreferences } from '../../shared/browser';
  import CookieImportDialog from '../components/browser/CookieImportDialog.svelte';

  let preferences = $state<SystemPreferences | null>(null);
  let notifications = $state(localStorage.getItem('hotel-butler.notifications') !== 'false');
  let error = $state('');

  onMount(() => {
    void window.hotelButler.system
      .getPreferences()
      .then((value) => {
        preferences = value;
      })
      .catch((reason: unknown) => {
        log.warn('System preferences could not be loaded', reason);
        error = reason instanceof Error ? reason.message : '设置读取失败';
      });
  });

  async function toggleAutoLaunch(enabled: boolean): Promise<void> {
    try {
      preferences = await window.hotelButler.system.setAutoLaunch(enabled);
    } catch (reason) {
      log.warn('Auto-launch preference could not be changed', reason);
      error = reason instanceof Error ? reason.message : '设置保存失败';
    }
  }

  function toggleNotifications(enabled: boolean): void {
    notifications = enabled;
    localStorage.setItem('hotel-butler.notifications', String(enabled));
  }
</script>

<main class="h-full overflow-auto bg-secondary px-9 py-10">
  <div class="mx-auto max-w-3xl">
    <header>
      <h1 class="m-0 text-[28px] font-semibold tracking-[-0.02em]">设置</h1>
    </header>

    {#if error}<p class="mt-4 text-sm text-destructive" role="alert">{error}</p>{/if}

    <section class="mt-6 overflow-hidden rounded-lg border border-border bg-card">
      <div class="flex items-center gap-3 border-b border-border px-6 py-4">
        <Settings2 size={18} class="text-muted-foreground" />
        <h2 class="m-0 text-sm font-semibold">常规</h2>
      </div>

      <div class="divide-y divide-border">
        <label class="flex items-center justify-between gap-6 px-6 py-4">
          <span class="flex items-center gap-3 text-sm">
            <MonitorUp size={17} class="text-muted-foreground" />
            开机自动启动
          </span>
          <input
            class="size-4 accent-primary"
            type="checkbox"
            checked={preferences?.autoLaunch ?? false}
            disabled={!preferences}
            onchange={(event) => void toggleAutoLaunch(event.currentTarget.checked)}
          />
        </label>
        <label class="flex items-center justify-between gap-6 px-6 py-4">
          <span class="flex items-center gap-3 text-sm">
            <Bell size={17} class="text-muted-foreground" />
            桌面通知
          </span>
          <input
            class="size-4 accent-primary"
            type="checkbox"
            checked={notifications}
            onchange={(event) => toggleNotifications(event.currentTarget.checked)}
          />
        </label>
        <div class="flex items-center justify-between gap-6 px-6 py-4">
          <span class="flex items-center gap-3 text-sm">
            <Cookie size={17} class="text-muted-foreground" />
            Cookie
          </span>
          <CookieImportDialog
            triggerLabel="导入 Cookie"
            triggerVariant="outline"
            triggerSize="sm"
          />
        </div>
      </div>
    </section>

    <section class="mt-5 rounded-lg border border-border bg-card px-6 py-5">
      <div class="flex items-center justify-between gap-6">
        <div>
          <h2 class="m-0 text-sm font-semibold">客户端版本</h2>
          <p class="mt-1 mb-0 text-xs text-muted-foreground">Hotel Butler 桌面客户端</p>
        </div>
        <span class="text-sm font-medium"
          >V{(preferences?.version ?? '1.0.0').replace(/\.0$/, '')}</span
        >
      </div>
    </section>
  </div>
</main>
