<script lang="ts">
  import { onMount } from 'svelte';
  import log from 'electron-log/renderer';
  import { errorFields } from '../logging';
  import FileText from '@lucide/svelte/icons/file-text';
  import MonitorUp from '@lucide/svelte/icons/monitor-up';
  import Settings2 from '@lucide/svelte/icons/settings-2';
  import { enter, PAGE_ENTER_OPTIONS } from '../motion';
  import type { SystemPreferences } from '../../shared/browser';
  import { Button } from '$lib/components/ui/button';
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
          ...errorFields(reason),
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
        ...errorFields(reason),
      });
      showSettingsError('设置保存失败，请重试。');
    } finally {
      savingAutoLaunch = false;
    }
  }

  async function openLogsDirectory(): Promise<void> {
    try {
      await window.hotelButler.system.openLogsDirectory();
      dismissAppNotification('settings-error');
    } catch (reason) {
      log.warn('Logs directory could not be opened', {
        ...errorFields(reason),
      });
      showSettingsError('打开日志目录失败，请重试。');
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
  class="h-full overflow-auto bg-[#f8fafb] px-9 py-9"
  data-motion="page"
  in:enter={PAGE_ENTER_OPTIONS}
>
  <div class="mx-auto max-w-3xl">
    <header>
      <h1 class="m-0 text-[28px] font-semibold tracking-[-0.02em]">设置</h1>
    </header>

    <section
      class="mt-6 overflow-hidden rounded-[12px] border border-border bg-card shadow-[var(--shadow-card)]"
    >
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
            class="size-4 accent-[#00b48a]"
            type="checkbox"
            checked={preferences?.autoLaunch ?? false}
            disabled={!preferences || savingAutoLaunch}
            onchange={(event) => void toggleAutoLaunch(event.currentTarget.checked)}
          />
        </label>
        <div class="flex items-center justify-between gap-6 px-6 py-4">
          <span class="flex flex-col gap-1 text-sm">
            <span class="flex items-center gap-3">
              <FileText size={17} class="text-muted-foreground" />
              运行日志
            </span>
            <span class="pl-[29px] text-xs text-muted-foreground"
              >反馈问题时，请把该目录下的 main.log 一并提供</span
            >
          </span>
          <Button variant="outline" size="sm" onclick={() => void openLogsDirectory()}>
            打开日志目录
          </Button>
        </div>
      </div>
    </section>

    <section
      class="mt-5 rounded-[12px] border border-border bg-card px-6 py-5 shadow-[var(--shadow-card)]"
    >
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
