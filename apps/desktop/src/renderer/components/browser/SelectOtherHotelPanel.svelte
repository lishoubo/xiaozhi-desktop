<script lang="ts">
  import log from 'electron-log/renderer';
  import Plus from '@lucide/svelte/icons/plus';
  import type { OtaAccountDto } from '../../../shared/browser';
  import { dismissAppNotification, showAppNotification } from '../../notifications';
  import { Button } from '$lib/components/ui/button';
  import { Spinner } from '$lib/components/ui/spinner';
  import * as Dialog from '$lib/components/ui/dialog';

  let {
    channelId,
    activeTabId,
    onSelect,
  }: {
    channelId: string;
    activeTabId: string | undefined;
    onSelect: (account: OtaAccountDto) => Promise<boolean>;
  } = $props();

  let open = $state(false);
  let loading = $state(false);
  let busy = $state(false);
  let accounts = $state<OtaAccountDto[]>([]);
  let tabToRestore: string | undefined;

  /**
   * `WebContentsView`（已打开的浏览器标签页）是原生合成视图，永远盖在
   * HTML 弹窗之上——打开面板前必须让当前激活的标签页先让路
   * （`browser.hide()`），关闭时再挂回去，否则弹窗内容会被浏览器标签页
   * 遮挡、点不到任何按钮（同 `AddAccountPanel.svelte` 已修复过的问题，
   * 见 commit da744a3/9530197）。选中账号创建新标签成功后不恢复旧标签，
   * 避免把新标签盖掉。
   */
  async function handleOpenChange(next: boolean, restorePreviousTab = true): Promise<void> {
    if (next) {
      dismissAppNotification('select-other-hotel-error');
      tabToRestore = activeTabId;
      open = true;
      loading = true;
      try {
        await window.hotelButler.browser.hide();
      } catch (reason) {
        log.warn('Browser tab could not yield to select-other-hotel panel', {
          errorName: reason instanceof Error ? reason.name : 'UnknownError',
        });
      }
      try {
        accounts = await window.hotelButler.otaAccount.listByChannel(channelId);
      } catch (reason) {
        log.warn('Existing ota accounts could not be loaded', {
          errorName: reason instanceof Error ? reason.name : 'UnknownError',
        });
        showAppNotification({
          id: 'select-other-hotel-error',
          title: '账号列表加载失败',
          message: '账号列表加载失败，请重试。',
          tone: 'error',
        });
        accounts = [];
      } finally {
        loading = false;
      }
      return;
    }

    open = false;
    if (restorePreviousTab && tabToRestore) {
      try {
        await window.hotelButler.browser.activate(tabToRestore);
      } catch (reason) {
        log.warn('Browser tab could not be restored after select-other-hotel panel closed', {
          errorName: reason instanceof Error ? reason.name : 'UnknownError',
        });
      }
    }
    tabToRestore = undefined;
  }

  async function selectAccount(account: OtaAccountDto): Promise<void> {
    dismissAppNotification('select-other-hotel-error');
    busy = true;
    try {
      const ok = await onSelect(account);
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
  服务商切换
</Button>

<Dialog.Root {open} onOpenChange={(next: boolean) => void handleOpenChange(next)}>
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title class="text-lg">服务商切换</Dialog.Title>
      <Dialog.Description>复用已登录账号的登录态，切换到另一家门店。</Dialog.Description>
    </Dialog.Header>

    {#if loading}
      <div class="flex items-center justify-center gap-2 py-10 text-muted-foreground">
        <Spinner class="size-[18px]" aria-label="正在加载" />
        <span>正在加载…</span>
      </div>
    {:else if accounts.length === 0}
      <p class="rounded-md bg-muted px-4 py-3 text-center text-sm text-muted-foreground">
        暂无该渠道已建号的账号。
      </p>
    {:else}
      <fieldset class="grid gap-2" disabled={busy}>
        <legend class="sr-only">选择已有账号复用登录态</legend>
        {#each accounts as account (account.id)}
          <button
            type="button"
            class="flex items-center gap-2 rounded-md border border-border px-4 py-3 text-left text-sm transition-colors duration-150 ease-out hover:bg-muted disabled:cursor-not-allowed disabled:opacity-55"
            disabled={busy}
            onclick={() => void selectAccount(account)}
          >
            {#if busy}<Spinner class="size-4" />{/if}
            {account.otaHotelName ?? account.otaHotelId}
          </button>
        {/each}
      </fieldset>
    {/if}
  </Dialog.Content>
</Dialog.Root>
