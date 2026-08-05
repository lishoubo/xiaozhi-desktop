<script lang="ts">
  import log from 'electron-log/renderer';
  import Plus from '@lucide/svelte/icons/plus';
  import type { BrowserTab, OtaAccountDto } from '../../../shared/browser';
  import type { OtaChannel } from '../../data/ota-channels';
  import { dismissAppNotification, showAppNotification } from '../../notifications';
  import { Button } from '$lib/components/ui/button';
  import { Spinner } from '$lib/components/ui/spinner';
  import * as Dialog from '$lib/components/ui/dialog';
  import CookieImportDialog from './CookieImportDialog.svelte';

  const DOUYIN_CHANNEL_ID = 'douyin';

  let {
    channel,
    activeTabId,
    existingAccounts,
    onAccountCreated,
    onNewLogin,
  }: {
    channel: OtaChannel;
    activeTabId: string | undefined;
    existingAccounts: readonly OtaAccountDto[];
    onAccountCreated: (tab: BrowserTab) => void;
    onNewLogin: () => Promise<boolean>;
  } = $props();

  let open = $state(false);
  let hasCookie = $state(false);
  let checkingCookie = $state(false);
  let busy = $state(false);
  let pickingExistingAccount = $state(false);
  let tabToRestore: string | undefined;

  let supportsExistingSession = $derived(channel.id === DOUYIN_CHANNEL_ID);

  /**
   * `WebContentsView`（已打开的浏览器标签页）是原生合成视图，永远盖在
   * HTML 弹窗之上，不受 Dialog 的 z-index/Portal 影响——打开面板前必须
   * 让当前激活的标签页先让路（`browser.hide()`），关闭时再挂回去，否则
   * 弹窗内容会被浏览器标签页遮挡、点不到任何按钮。
   *
   * `restorePreviousTab`：面板内创建了新标签页后关闭（`createFromCookie`
   * /`createFromExistingSession`/`newLogin` 成功后）不能恢复到打开面板前
   * 的旧标签页——那样会把刚创建、已经被主进程 activate 的新标签页盖掉，
   * 是本次真机验证发现的问题。只有用户主动取消/点关闭（没有创建成功）
   * 才需要恢复旧标签页。
   */
  async function handleOpenChange(next: boolean, restorePreviousTab = true): Promise<void> {
    if (next) {
      dismissAppNotification('add-account-error');
      pickingExistingAccount = false;
      tabToRestore = activeTabId;
      open = true;
      try {
        await window.hotelButler.browser.hide();
      } catch (reason) {
        log.warn('Browser tab could not yield to add-account panel', {
          errorName: reason instanceof Error ? reason.name : 'UnknownError',
        });
      }
      await refreshCookieAvailability();
      return;
    }

    open = false;
    if (restorePreviousTab && tabToRestore) {
      try {
        await window.hotelButler.browser.activate(tabToRestore);
      } catch (reason) {
        log.warn('Browser tab could not be restored after add-account panel closed', {
          errorName: reason instanceof Error ? reason.name : 'UnknownError',
        });
      }
    }
    tabToRestore = undefined;
  }

  async function refreshCookieAvailability(): Promise<void> {
    checkingCookie = true;
    try {
      hasCookie = await window.hotelButler.otaAccount.hasImportedCookies(channel.id);
    } catch (reason) {
      log.warn('Cookie availability check failed', {
        errorName: reason instanceof Error ? reason.name : 'UnknownError',
      });
      hasCookie = false;
    } finally {
      checkingCookie = false;
    }
  }

  function reportFailure(message: string, reason: unknown): void {
    log.warn('Add account action failed', {
      errorName: reason instanceof Error ? reason.name : 'UnknownError',
    });
    showAppNotification({ id: 'add-account-error', title: '添加账号失败', message, tone: 'error' });
  }

  async function createFromCookie(): Promise<void> {
    dismissAppNotification('add-account-error');
    busy = true;
    try {
      const tab = await window.hotelButler.otaAccount.createFromCookie({
        channelId: channel.id,
        environment: 'prod',
        url: channel.url,
      });
      await handleOpenChange(false, false);
      onAccountCreated(tab);
    } catch (reason) {
      reportFailure('从 Cookie 创建账号失败，请重试或改用新建账号。', reason);
    } finally {
      busy = false;
    }
  }

  async function createFromExistingSession(account: OtaAccountDto): Promise<void> {
    dismissAppNotification('add-account-error');
    busy = true;
    try {
      const tab = await window.hotelButler.otaAccount.createFromExistingSession(account.id);
      await handleOpenChange(false, false);
      onAccountCreated(tab);
    } catch (reason) {
      reportFailure('从其他登录态创建账号失败，请重试。', reason);
    } finally {
      busy = false;
    }
  }

  async function newLogin(): Promise<void> {
    dismissAppNotification('add-account-error');
    busy = true;
    try {
      const ok = await onNewLogin();
      if (ok) await handleOpenChange(false, false);
    } finally {
      busy = false;
    }
  }
</script>

<Button
  variant="ghost"
  size="sm"
  class="h-7 shrink-0 gap-1 px-2 text-xs"
  onclick={() => void handleOpenChange(true)}
>
  <Plus size={13} strokeWidth={1.8} />
  添加账号
</Button>

<Dialog.Root {open} onOpenChange={(next: boolean) => void handleOpenChange(next)}>
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title class="text-lg">添加账号 · {channel.name}</Dialog.Title>
      <Dialog.Description>选择添加方式。</Dialog.Description>
    </Dialog.Header>

    {#if pickingExistingAccount}
      <fieldset class="grid gap-2" disabled={busy}>
        <legend class="sr-only">选择已有账号复用登录态</legend>
        {#each existingAccounts as account (account.id)}
          <button
            type="button"
            class="flex items-center gap-2 rounded-md border border-border px-4 py-3 text-left text-sm transition-colors duration-150 ease-out hover:bg-muted disabled:cursor-not-allowed disabled:opacity-55"
            disabled={busy}
            onclick={() => void createFromExistingSession(account)}
          >
            {account.otaHotelName ?? account.otaHotelId}
          </button>
        {/each}
      </fieldset>
      <Dialog.Footer>
        <Button variant="ghost" disabled={busy} onclick={() => (pickingExistingAccount = false)}>
          返回
        </Button>
      </Dialog.Footer>
    {:else}
      <div class="grid grid-cols-2 gap-2">
        <CookieImportDialog
          triggerLabel="导入 Cookie"
          triggerVariant="outline"
          onComplete={refreshCookieAvailability}
        />
        <Button
          variant="outline"
          disabled={!hasCookie || checkingCookie || busy}
          onclick={() => void createFromCookie()}
        >
          {#if busy}<Spinner class="size-4" />{/if}
          从 Cookie 创建
        </Button>
        {#if supportsExistingSession}
          <Button
            variant="outline"
            disabled={existingAccounts.length === 0 || busy}
            onclick={() => (pickingExistingAccount = true)}
          >
            从其他登录态创建
          </Button>
        {/if}
        <Button disabled={busy} onclick={() => void newLogin()}>
          {#if busy}<Spinner class="size-4" />{/if}
          新建账号
        </Button>
      </div>
    {/if}
  </Dialog.Content>
</Dialog.Root>
