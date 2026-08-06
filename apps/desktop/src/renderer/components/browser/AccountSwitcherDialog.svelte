<script lang="ts">
  import log from 'electron-log/renderer';
  import Check from '@lucide/svelte/icons/check';
  import Plus from '@lucide/svelte/icons/plus';
  import type { OtaChannel } from '../../data/ota-channels';
  import { dismissAppNotification, showAppNotification } from '../../notifications';
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Spinner } from '$lib/components/ui/spinner';
  import type { LoginCredentialOption } from './login-credential-options';
  import CookieImportDialog from './CookieImportDialog.svelte';

  type Props = Readonly<{
    channel: OtaChannel;
    credentials: readonly LoginCredentialOption[];
    activeCredential: LoginCredentialOption | undefined;
    activeTabId: string | undefined;
    onSelectCredential: (credential: LoginCredentialOption) => Promise<boolean>;
    onCookieImport: () => Promise<boolean>;
    onNewLogin: () => Promise<boolean>;
  }>;

  let {
    channel,
    credentials,
    activeCredential,
    activeTabId,
    onSelectCredential,
    onCookieImport,
    onNewLogin,
  }: Props = $props();

  let open = $state(false);
  let busyPartition = $state<string | null>(null);
  let startingLogin = $state(false);
  let tabToRestore: string | undefined;

  async function handleOpenChange(next: boolean, restorePreviousTab = true): Promise<void> {
    if (next) {
      dismissAppNotification('account-switcher-error');
      tabToRestore = activeTabId;
      open = true;
      try {
        await window.hotelButler.browser.hide();
      } catch (reason) {
        log.warn('Browser tab could not yield to account switcher', {
          errorName: reason instanceof Error ? reason.name : 'UnknownError',
        });
      }
      return;
    }

    open = false;
    if (restorePreviousTab && tabToRestore) {
      try {
        await window.hotelButler.browser.activate(tabToRestore);
      } catch (reason) {
        log.warn('Browser tab could not be restored after account switcher closed', {
          errorName: reason instanceof Error ? reason.name : 'UnknownError',
        });
      }
    }
    tabToRestore = undefined;
  }

  async function selectCredential(credential: LoginCredentialOption): Promise<void> {
    if (credential.partitionName === activeCredential?.partitionName) {
      await handleOpenChange(false);
      return;
    }

    dismissAppNotification('account-switcher-error');
    busyPartition = credential.partitionName;
    try {
      const switched = await onSelectCredential(credential);
      if (switched) await handleOpenChange(false, false);
    } finally {
      busyPartition = null;
    }
  }

  async function startNewLogin(): Promise<void> {
    dismissAppNotification('account-switcher-error');
    startingLogin = true;
    try {
      const started = await onNewLogin();
      if (started) await handleOpenChange(false, false);
    } catch (reason) {
      log.warn('New channel login could not be started from account switcher', {
        errorName: reason instanceof Error ? reason.name : 'UnknownError',
      });
      showAppNotification({
        id: 'account-switcher-error',
        title: '登录账号失败',
        message: '新账号页面打开失败，请重试。',
        tone: 'error',
      });
    } finally {
      startingLogin = false;
    }
  }

  async function finishCookieImport(): Promise<void> {
    const started = await onCookieImport();
    if (started) await handleOpenChange(false, false);
  }
</script>

<Button
  variant="outline"
  size="icon"
  class="size-9 rounded-[10px] border-[#d9dee7] bg-white shadow-none hover:bg-[#eef1f5]"
  aria-label="切换登录账号"
  title="切换登录账号"
  onclick={() => void handleOpenChange(true)}
>
  <Plus size={18} strokeWidth={1.8} />
</Button>

<Dialog.Root {open} onOpenChange={(next: boolean) => void handleOpenChange(next)}>
  <Dialog.Content
    class="max-h-[min(760px,calc(100vh-48px))] gap-5 overflow-y-auto p-7 sm:max-w-4xl"
  >
    <Dialog.Header class="pr-10">
      <div class="flex items-center justify-between gap-6">
        <div class="flex min-w-0 items-center gap-3">
          <span class="grid size-11 shrink-0 place-items-center rounded-xl bg-[#f4f6fa]">
            <img class="size-7 object-contain" src={channel.iconUrl} alt="" />
          </span>
          <Dialog.Title class="truncate text-xl">已登录账号列表</Dialog.Title>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <CookieImportDialog
            triggerLabel="从 Cookie 导入"
            triggerVariant="outline"
            onComplete={finishCookieImport}
          />
          <Button
            class="h-10 shrink-0 gap-2 px-4"
            disabled={startingLogin || busyPartition !== null}
            onclick={() => void startNewLogin()}
          >
            {#if startingLogin}<Spinner class="size-4" />{:else}<Plus size={17} />{/if}
            登录新渠道账号
          </Button>
        </div>
      </div>
      <Dialog.Description class="sr-only">
        切换 {channel.name} 已保存的登录账号、从 Cookie 导入或登录新的渠道账号。
      </Dialog.Description>
    </Dialog.Header>

    {#if credentials.length === 0}
      <div
        class="grid min-h-40 place-items-center rounded-xl bg-[#f7f8fa] px-6 text-sm text-[#747b89]"
      >
        当前渠道暂无登录凭据
      </div>
    {:else}
      <div class="grid gap-3" aria-label={`${channel.name} 已登录账号`}>
        {#each credentials as credential (credential.partitionName)}
          {@const isActive = credential.partitionName === activeCredential?.partitionName}
          <button
            type="button"
            class={[
              'group flex min-h-24 w-full items-center justify-between gap-5 rounded-xl border px-6 py-5 text-left transition-[border-color,background-color,box-shadow] duration-150 ease-out outline-none motion-reduce:transition-none',
              isActive
                ? 'border-primary/35 bg-primary/[0.035] shadow-sm'
                : 'border-[#e5e8ed] bg-[#f7f8fa] hover:border-[#cfd4dc] hover:bg-[#f2f4f7]',
            ]}
            disabled={startingLogin || busyPartition !== null}
            aria-pressed={isActive}
            onclick={() => void selectCredential(credential)}
          >
            <span class="min-w-0">
              <span class="mb-3 flex items-center gap-2.5">
                <span
                  class={[
                    'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-medium',
                    isActive ? 'bg-[#58aa16] text-white' : 'bg-[#777d8d] text-white',
                  ]}
                >
                  {#if isActive}<Check size={15} strokeWidth={2.2} />{/if}
                  {isActive ? '已打开' : '未打开'}
                </span>
                <span class="text-base font-semibold text-[#292e3a]">{channel.shortName}</span>
              </span>
              <span class="block truncate text-sm text-[#747b89]">
                {isActive ? '当前使用账号' : '登录账号'}：{credential.label}
              </span>
            </span>

            {#if busyPartition === credential.partitionName}
              <Spinner class="size-5 shrink-0" aria-label="正在切换账号" />
            {/if}
          </button>
        {/each}
      </div>
    {/if}
  </Dialog.Content>
</Dialog.Root>
