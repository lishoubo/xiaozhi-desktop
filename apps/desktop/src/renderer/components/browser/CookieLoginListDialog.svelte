<script lang="ts">
  import { onMount } from 'svelte';
  import log from 'electron-log/renderer';
  import { errorFields } from '../../logging';
  import { push } from 'svelte-spa-router';
  import type { ImportedChannelSummary } from '../../../shared/browser';
  import { OTA_CHANNELS } from '../../data/ota-channels';
  import { dismissAppNotification, showAppNotification } from '../../notifications';
  import { cookieListAutoOpen, tabActivation } from './cross-route-intents';
  import { Button } from '$lib/components/ui/button';
  import { Spinner } from '$lib/components/ui/spinner';
  import * as Dialog from '$lib/components/ui/dialog';
  import CookieImportDialog from './CookieImportDialog.svelte';

  let open = $state(false);
  let loading = $state(false);
  let summaries = $state<ImportedChannelSummary[]>([]);
  let busyChannel = $state<string | null>(null);

  function channelName(channelId: string): string {
    return OTA_CHANNELS.find((item) => item.id === channelId)?.name ?? channelId;
  }

  function channelUrl(channelId: string): string {
    return OTA_CHANNELS.find((item) => item.id === channelId)?.url ?? '';
  }

  function formatImportedAt(iso: string): string {
    try {
      return new Date(iso).toLocaleString('zh-CN', { hour12: false });
    } catch {
      return iso;
    }
  }

  async function refreshList(): Promise<void> {
    loading = true;
    try {
      summaries = await window.hotelButler.cookies.listImportedChannels();
    } catch (reason) {
      log.warn('Imported cookie channels could not be loaded', {
        ...errorFields(reason),
      });
      summaries = [];
    } finally {
      loading = false;
    }
  }

  async function openDialog(): Promise<void> {
    dismissAppNotification('cookie-login-list-error');
    open = true;
    await refreshList();
  }

  onMount(() => {
    if (cookieListAutoOpen.consume()) void openDialog();
  });

  function reportFailure(message: string, reason: unknown): void {
    // `busyChannel` 要到 `finally` 才清空，此刻仍是出错的那个渠道。
    log.warn('Cookie login list action failed', {
      channelId: busyChannel,
      ...errorFields(reason),
    });
    showAppNotification({
      id: 'cookie-login-list-error',
      title: '登录账号失败',
      message,
      tone: 'error',
    });
  }

  async function loginWithCookie(channelId: string): Promise<void> {
    dismissAppNotification('cookie-login-list-error');
    busyChannel = channelId;
    try {
      const tab = await window.hotelButler.otaTab.openWithImportedCookie({
        channelId,
        url: channelUrl(channelId),
      });
      tabActivation.set(tab);
      open = false;
      await push('/');
    } catch (reason) {
      reportFailure('从 Cookie 登录账号失败，请重试。', reason);
    } finally {
      busyChannel = null;
    }
  }
</script>

<Button variant="outline" size="sm" onclick={() => void openDialog()}>已登录 Cookie 列表</Button>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-lg">
    <Dialog.Header>
      <Dialog.Title class="text-lg">已登录 Cookie 列表</Dialog.Title>
      <Dialog.Description>按渠道展示已导入的登录态，可直接用其登录账号。</Dialog.Description>
    </Dialog.Header>

    <div class="flex justify-end">
      <CookieImportDialog
        triggerLabel="导入 Cookie"
        triggerVariant="outline"
        triggerSize="sm"
        showSuccessNotification
        onComplete={refreshList}
      />
    </div>

    {#if loading}
      <div class="flex items-center justify-center gap-2 py-10 text-muted-foreground">
        <Spinner class="size-[18px]" aria-label="正在加载" />
        <span>正在加载…</span>
      </div>
    {:else if summaries.length === 0}
      <p class="rounded-md bg-muted px-4 py-3 text-center text-sm text-muted-foreground">
        暂无已导入的 Cookie，点击上方"导入 Cookie"开始。
      </p>
    {:else}
      <ul class="grid gap-2">
        {#each summaries as summary (summary.channel)}
          <li
            class="flex items-center justify-between gap-3 rounded-md border border-border px-4 py-3"
          >
            <div class="min-w-0">
              <p class="truncate text-sm font-medium">{channelName(summary.channel)}</p>
              <p class="text-xs text-muted-foreground">
                导入于 {formatImportedAt(summary.importedAt)}
              </p>
            </div>
            <Button
              size="sm"
              disabled={busyChannel !== null}
              onclick={() => void loginWithCookie(summary.channel)}
            >
              {#if busyChannel === summary.channel}<Spinner class="size-4" />{/if}
              登录账号
            </Button>
          </li>
        {/each}
      </ul>
    {/if}
  </Dialog.Content>
</Dialog.Root>
