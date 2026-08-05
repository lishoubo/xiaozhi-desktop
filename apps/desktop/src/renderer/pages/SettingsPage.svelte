<script lang="ts">
  import { onMount } from 'svelte';
  import log from 'electron-log/renderer';
  import Cookie from '@lucide/svelte/icons/cookie';
  import MonitorUp from '@lucide/svelte/icons/monitor-up';
  import Settings2 from '@lucide/svelte/icons/settings-2';
  import { enter, PAGE_ENTER_OPTIONS } from '../motion';
  import type { SystemPreferences } from '../../shared/browser';
  import CookieLoginListDialog from '../components/browser/CookieLoginListDialog.svelte';
  import { dismissAppNotification, showAppNotification } from '../notifications';

  let preferences = $state<SystemPreferences | null>(null);
  let savingAutoLaunch = $state(false);

  onMount(() => {
    void window.hotelButler.system
      .getPreferences()
      .then((value) => {
        preferences = value;
        dismissAppNotification('settings-error');
      })
      .catch((reason: unknown) => {
        log.warn('System preferences could not be loaded', {
          errorName: reason instanceof Error ? reason.name : 'UnknownError',
        });
        showSettingsError('设置读取失败，请重试。');
      });
  });

  async function toggleAutoLaunch(enabled: boolean): Promise<void> {
    if (savingAutoLaunch) return;
    savingAutoLaunch = true;
    try {
      preferences = await window.hotelButler.system.setAutoLaunch(enabled);
      dismissAppNotification('settings-error');
    } catch (reason) {
      log.warn('Auto-launch preference could not be changed', {
        errorName: reason instanceof Error ? reason.name : 'UnknownError',
      });
      showSettingsError('设置保存失败，请重试。');
    } finally {
      savingAutoLaunch = false;
    }
  }

  function showSettingsError(message: string): void {
    showAppNotification({
      id: 'settings-error',
      title: '设置操作失败',
      message,
      tone: 'error',
    });
  }
</script>

<main
  class="h-full overflow-auto bg-secondary px-9 py-10"
  data-motion="page"
  in:enter={PAGE_ENTER_OPTIONS}
>
  <div class="mx-auto max-w-3xl">
    <header>
      <h1 class="m-0 text-[28px] font-semibold tracking-[-0.02em]">设置</h1>
    </header>

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
            disabled={!preferences || savingAutoLaunch}
            onchange={(event) => void toggleAutoLaunch(event.currentTarget.checked)}
          />
        </label>
        <div class="flex items-center justify-between gap-6 px-6 py-4">
          <span class="flex items-center gap-3 text-sm">
            <Cookie size={17} class="text-muted-foreground" />
            Cookie
          </span>
          <CookieLoginListDialog />
        </div>
      </div>
    </section>

    <section class="mt-5 rounded-lg border border-border bg-card px-6 py-5">
      <div class="flex items-center justify-between gap-6">
        <div>
          <h2 class="m-0 text-sm font-semibold">客户端版本</h2>
          <p class="mt-1 mb-0 text-xs text-muted-foreground">小智酒店管家桌面客户端</p>
        </div>
        <span class="text-sm font-medium"
          >V{(preferences?.version ?? '1.0.0').replace(/\.0$/, '')}</span
        >
      </div>
    </section>
  </div>
</main>
