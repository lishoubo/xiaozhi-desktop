<script lang="ts">
  import { autoAnimate } from '@formkit/auto-animate';
  import { onMount } from 'svelte';
  import log from 'electron-log/renderer';
  import { push } from 'svelte-spa-router';
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import Import from '@lucide/svelte/icons/import';
  import Plus from '@lucide/svelte/icons/plus';
  import RotateCw from '@lucide/svelte/icons/rotate-cw';
  import VolumeX from '@lucide/svelte/icons/volume-x';
  import X from '@lucide/svelte/icons/x';
  import type { BrowserTab, OtaAccountDto } from '../../../shared/browser';
  import {
    enter,
    LAYOUT_ANIMATION_OPTIONS,
    PAGE_ENTER_OPTIONS,
    SURFACE_TRANSITION_OPTIONS,
  } from '../../motion';
  import { OTA_CHANNELS, type OtaChannel } from '../../data/ota-channels';
  import { dismissAppNotification, showAppNotification } from '../../notifications';
  import { consumePendingTabActivation } from '../../pending-tab-activation';
  import { requestCookieListAutoOpen } from '../../pending-cookie-list-open';
  import { Button } from '$lib/components/ui/button';
  import { Spinner } from '$lib/components/ui/spinner';
  import AccountSwitcherDialog from './AccountSwitcherDialog.svelte';
  import CookieImportDialog from './CookieImportDialog.svelte';
  import {
    buildLoginSessionOptions,
    currentLoginSession,
    type LoginSessionOption,
  } from './login-session-options';

  const COOKIE_PROMPT_KEY = 'hotel-butler.cookie-import-prompted';
  let activeChannelId = $state(OTA_CHANNELS[0].id);
  let activeTabIds = $state<Record<string, string>>({});
  let tabsByChannel = $state<Record<string, BrowserTab[]>>({});
  let accountsByChannel = $state<Record<string, OtaAccountDto[]>>({});
  let viewport: HTMLElement | undefined;
  let cookiePrompt = $state(false);
  let openingSessionTab = $state(false);
  let activeTabs = $derived(tabsByChannel[activeChannelId] ?? []);
  let activeTab = $derived(
    activeTabs.find((tab) => tab.id === activeTabIds[activeChannelId]) ?? activeTabs[0],
  );
  let activeAccounts = $derived(accountsByChannel[activeChannelId] ?? []);
  let activeChannel = $derived(OTA_CHANNELS.find((item) => item.id === activeChannelId));
  let activeSessions = $derived(buildLoginSessionOptions(activeAccounts));
  let activeSession = $derived(currentLoginSession(activeSessions, activeTab?.partitionName));

  function reportBrowserFailure(event: string, message: string, reason: unknown): void {
    log.warn(event, {
      errorName: reason instanceof Error ? reason.name : 'UnknownError',
    });
    showAppNotification({
      id: 'browser-operation-error',
      title: '页面操作失败',
      message,
      tone: 'error',
    });
  }

  function updateTab(next: BrowserTab): void {
    const tabs = tabsByChannel[next.channelId] ?? [];
    const index = tabs.findIndex((tab) => tab.id === next.id);
    tabsByChannel[next.channelId] =
      index === -1 ? [...tabs, next] : tabs.map((tab) => (tab.id === next.id ? next : tab));
    if (index === -1 || !activeTabIds[next.channelId]) activeTabIds[next.channelId] = next.id;
  }

  async function createTab(channel: OtaChannel, url = channel.url): Promise<BrowserTab | null> {
    try {
      dismissAppNotification('browser-operation-error');
      const tab = await window.hotelButler.otaAccount.startLogin({
        channelId: channel.id,
        environment: 'prod',
        url,
      });
      updateTab(tab);
      activeTabIds[channel.id] = tab.id;
      await syncBounds();
      return tab;
    } catch (error) {
      reportBrowserFailure('Browser tab could not be created', '页面打开失败，请重试', error);
      return null;
    }
  }

  async function loadAccounts(channelId: string): Promise<void> {
    try {
      accountsByChannel[channelId] = await window.hotelButler.otaAccount.listByChannel(channelId);
    } catch (error) {
      reportBrowserFailure('Ota accounts could not be loaded', '账号列表加载失败，请重试', error);
    }
  }

  async function selectChannel(channel: OtaChannel): Promise<void> {
    dismissAppNotification('browser-operation-error');
    activeChannelId = channel.id;
    void loadAccounts(channel.id);
    const tabId = activeTabIds[channel.id];
    try {
      if (tabId) {
        await window.hotelButler.browser.activate(tabId);
      } else {
        // 新渠道没有已打开的标签页——`activate` 不会被调用，若不显式 `hide`，
        // 上一个渠道的 WebContentsView 会一直挂在 contentView 上不被移除。
        await window.hotelButler.browser.hide();
      }
      await syncBounds();
    } catch (error) {
      reportBrowserFailure('Browser channel could not be selected', '渠道切换失败，请重试', error);
    }
  }

  async function openExistingAccountTab(account: OtaAccountDto): Promise<BrowserTab | null> {
    dismissAppNotification('browser-operation-error');
    try {
      const tab = await window.hotelButler.otaAccount.openExisting(account.id);
      updateTab(tab);
      activeTabIds[account.channel] = tab.id;
      await syncBounds();
      return tab;
    } catch (error) {
      reportBrowserFailure(
        'Ota account tab could not be opened',
        '打开账号页面失败，请重试',
        error,
      );
      return null;
    }
  }

  async function closeSupersededTabs(
    channelId: string,
    targetPartitionName: string,
    previousTabs: readonly BrowserTab[],
  ): Promise<void> {
    const closedTabIds = new Set<string>();
    for (const tab of previousTabs) {
      if (tab.partitionName === targetPartitionName) continue;
      try {
        await window.hotelButler.browser.close(tab.id);
        closedTabIds.add(tab.id);
      } catch (error) {
        reportBrowserFailure(
          'Superseded browser tab could not be closed',
          '旧账号页面关闭失败，请手动关闭',
          error,
        );
      }
    }
    if (closedTabIds.size > 0) {
      tabsByChannel[channelId] = (tabsByChannel[channelId] ?? []).filter(
        (tab) => !closedTabIds.has(tab.id),
      );
    }
  }

  async function openNewTabForActiveSession(): Promise<void> {
    if (!activeSession || openingSessionTab) return;
    openingSessionTab = true;
    try {
      await openExistingAccountTab(activeSession.representativeAccount);
    } finally {
      openingSessionTab = false;
    }
  }

  async function switchLoginSession(session: LoginSessionOption): Promise<boolean> {
    const previousTabs = [...activeTabs];
    const alreadyOpen = previousTabs.find((tab) => tab.partitionName === session.partitionName);
    let targetTab = alreadyOpen;

    if (targetTab) {
      try {
        await window.hotelButler.browser.activate(targetTab.id);
        activeTabIds[targetTab.channelId] = targetTab.id;
      } catch (error) {
        reportBrowserFailure(
          'Existing account tab could not be activated',
          '账号切换失败，请重试',
          error,
        );
        return false;
      }
    } else {
      targetTab = (await openExistingAccountTab(session.representativeAccount)) ?? undefined;
      if (!targetTab) return false;
    }

    await closeSupersededTabs(targetTab.channelId, targetTab.partitionName, previousTabs);
    await syncBounds();
    return true;
  }

  async function newLoginForActiveChannel(): Promise<boolean> {
    const channel = OTA_CHANNELS.find((item) => item.id === activeChannelId);
    if (!channel) return false;
    const previousTabs = [...activeTabs];
    const tab = await createTab(channel);
    if (!tab) return false;
    await closeSupersededTabs(tab.channelId, tab.partitionName, previousTabs);
    return true;
  }

  async function selectTab(tab: BrowserTab): Promise<void> {
    dismissAppNotification('browser-operation-error');
    try {
      await window.hotelButler.browser.activate(tab.id);
      activeTabIds[tab.channelId] = tab.id;
      await syncBounds();
    } catch (error) {
      reportBrowserFailure('Browser tab could not be selected', '标签切换失败，请重试', error);
    }
  }

  async function closeTab(tab: BrowserTab): Promise<void> {
    dismissAppNotification('browser-operation-error');
    try {
      const tabs = tabsByChannel[tab.channelId] ?? [];
      const index = tabs.findIndex((item) => item.id === tab.id);
      await window.hotelButler.browser.close(tab.id);
      const nextTabs = tabs.filter((item) => item.id !== tab.id);
      tabsByChannel[tab.channelId] = nextTabs;
      if (activeTabIds[tab.channelId] === tab.id) {
        const next = nextTabs[Math.min(index, nextTabs.length - 1)];
        if (next) {
          await window.hotelButler.browser.activate(next.id);
          activeTabIds[tab.channelId] = next.id;
        } else {
          delete activeTabIds[tab.channelId];
        }
      }
    } catch (error) {
      reportBrowserFailure('Browser tab could not be closed', '标签关闭失败，请重试', error);
    }
  }

  async function syncBounds(): Promise<void> {
    if (!viewport) return;
    try {
      const bounds = viewport.getBoundingClientRect();
      await window.hotelButler.browser.setBounds({
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      });
    } catch (error) {
      reportBrowserFailure(
        'Browser viewport could not be synchronized',
        '页面区域同步失败，请调整窗口后重试',
        error,
      );
    }
  }

  function browserViewport(node: HTMLElement): () => void {
    viewport = node;
    return () => {
      if (viewport === node) viewport = undefined;
    };
  }

  function finishCookiePrompt(): void {
    cookiePrompt = false;
    localStorage.setItem(COOKIE_PROMPT_KEY, 'true');
  }

  async function finishCookiePromptAndReviewImports(): Promise<void> {
    finishCookiePrompt();
    requestCookieListAutoOpen();
    await push('/settings');
  }

  async function runNavigationAction(event: string, action: () => Promise<void>): Promise<void> {
    dismissAppNotification('browser-operation-error');
    try {
      await action();
    } catch (error) {
      reportBrowserFailure(event, '页面操作失败，请重试', error);
    }
  }

  onMount(() => {
    let mounted = true;
    const unsubscribe = window.hotelButler.browser.onStateChanged((tab) => {
      updateTab(tab);
    });
    const unsubscribeInterception = window.hotelButler.browser.onRequestIntercepted(() => {
      showAppNotification({
        id: 'browser-request-intercepted',
        title: '请求拦截成功',
        message: '已拦截携程接口请求：/restapi/soa2/**',
        tone: 'default',
      });
    });
    const unsubscribeAccountBound = window.hotelButler.otaAccount.onAccountBound(({ channel }) => {
      if (channel === activeChannelId) void loadAccounts(channel);
    });
    const observer = new ResizeObserver(() => void syncBounds());
    if (viewport) observer.observe(viewport);
    window.addEventListener('resize', syncBounds);
    const pendingTab = consumePendingTabActivation();
    if (pendingTab) {
      updateTab(pendingTab);
      activeChannelId = pendingTab.channelId;
      activeTabIds[pendingTab.channelId] = pendingTab.id;
      void loadAccounts(pendingTab.channelId);
      cookiePrompt = false;
      void window.hotelButler.browser
        .activate(pendingTab.id)
        .then(() => syncBounds())
        .catch((error: unknown) => {
          if (mounted) {
            reportBrowserFailure(
              'Pending tab could not be activated',
              '标签激活失败，请重试',
              error,
            );
          }
        });
    } else {
      void loadAccounts(activeChannelId);
      cookiePrompt = localStorage.getItem(COOKIE_PROMPT_KEY) !== 'true';
      if (!cookiePrompt) {
        void window.hotelButler.browser
          .list()
          .then(async (tabs) => {
            if (!mounted) return;
            for (const tab of tabs) updateTab(tab);
            const ctripTab = tabs.find((tab) => tab.channelId === OTA_CHANNELS[0].id);
            if (ctripTab) {
              await window.hotelButler.browser.activate(ctripTab.id);
              if (!mounted) return;
              activeTabIds[ctripTab.channelId] = ctripTab.id;
              await syncBounds();
            }
          })
          .catch((error: unknown) => {
            if (mounted) {
              reportBrowserFailure(
                'Browser workspace could not be loaded',
                '浏览器工作区加载失败，请重试',
                error,
              );
            }
          });
      }
    }
    return () => {
      mounted = false;
      void Promise.resolve(window.hotelButler.browser.hide()).catch((error: unknown) => {
        log.warn('Browser workspace could not be hidden', {
          errorName: error instanceof Error ? error.name : 'UnknownError',
        });
      });
      unsubscribe();
      unsubscribeInterception();
      unsubscribeAccountBound();
      observer.disconnect();
      window.removeEventListener('resize', syncBounds);
    };
  });
</script>

<main
  class="grid h-full min-h-0 grid-rows-[64px_64px_minmax(0,1fr)] bg-background"
  data-motion="page"
  in:enter={{ ...PAGE_ENTER_OPTIONS, y: 0 }}
>
  <nav
    class="flex min-w-0 items-center gap-1 overflow-x-auto border-b border-[#e5e7eb] bg-[#f4f6fa] px-4"
    aria-label="OTA 快捷入口"
  >
    {#each OTA_CHANNELS as channel (channel.id)}
      <button
        class={[
          'flex h-10 shrink-0 items-center justify-center gap-[7px] rounded-lg border px-2.5 text-sm font-medium whitespace-nowrap transition-[background-color,border-color,color,box-shadow] duration-150 ease-out motion-reduce:transition-none',
          activeChannelId === channel.id
            ? 'border-[#e2e6ec] bg-white text-[#242936] shadow-sm'
            : 'border-transparent text-[#5f6673] hover:bg-[#eaedf3] hover:text-[#242936]',
        ]}
        type="button"
        aria-label={channel.name}
        aria-pressed={activeChannelId === channel.id}
        title={channel.name}
        onclick={() => void selectChannel(channel)}
      >
        <img class="size-5 rounded-sm object-contain" src={channel.iconUrl} alt="" />
        <span>{channel.shortName}</span>
      </button>
    {/each}
  </nav>

  <div
    class="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-[#e5e7eb] bg-[#fafbfc] px-4"
  >
    <nav class="flex shrink-0 items-center gap-1" aria-label="页面控制">
      <Button
        variant="ghost"
        size="icon-sm"
        class="text-[#5f6673] hover:bg-[#eef1f5]"
        aria-label="后退"
        disabled={!activeTab?.canGoBack}
        onclick={() =>
          activeTab &&
          void runNavigationAction('Browser could not go back', () =>
            window.hotelButler.browser.goBack(activeTab.id),
          )}
      >
        <ArrowLeft size={16} strokeWidth={1.8} />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        class="text-[#5f6673] hover:bg-[#eef1f5]"
        aria-label="前进"
        disabled={!activeTab?.canGoForward}
        onclick={() =>
          activeTab &&
          void runNavigationAction('Browser could not go forward', () =>
            window.hotelButler.browser.goForward(activeTab.id),
          )}
      >
        <ArrowRight size={16} strokeWidth={1.8} />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        class="text-[#5f6673] hover:bg-[#eef1f5]"
        aria-label="刷新"
        disabled={!activeTab}
        onclick={() =>
          activeTab &&
          void runNavigationAction('Browser page could not be reloaded', () =>
            window.hotelButler.browser.reload(activeTab.id),
          )}
      >
        {#if activeTab?.loading}
          <Spinner aria-label="页面加载中" />
        {:else}
          <RotateCw size={16} strokeWidth={1.8} />
        {/if}
      </Button>
      <span class="ml-2 h-6 w-px bg-[#e1e4e9]" aria-hidden="true"></span>
    </nav>

    <div
      class="flex min-w-0 items-center gap-1 overflow-x-auto"
      role="tablist"
      aria-label="已打开页面"
      use:autoAnimate={LAYOUT_ANIMATION_OPTIONS}
    >
      {#each activeTabs as tab (tab.id)}
        <div
          class={[
            'group flex h-10 min-w-[132px] max-w-[200px] items-center rounded-lg border text-xs transition-[background-color,border-color,color] duration-150 ease-out motion-reduce:transition-none',
            activeTab?.id === tab.id
              ? 'border-[#e2e6ec] bg-white text-[#242936]'
              : 'border-transparent text-[#5f6673] hover:bg-[#f0f2f5] hover:text-[#242936]',
          ]}
        >
          <button
            class="flex min-w-0 flex-1 items-center gap-2 self-stretch px-3 text-left"
            type="button"
            role="tab"
            aria-selected={activeTab?.id === tab.id}
            onclick={() => void selectTab(tab)}
          >
            {#if tab.loading}
              <Spinner class="size-[13px] shrink-0" aria-label={`${tab.title}正在加载`} />
            {/if}
            <span class="min-w-0 flex-1 truncate">{tab.title}</span>
          </button>
          <button
            class="mr-1 grid size-6 shrink-0 place-items-center rounded hover:bg-black/10"
            type="button"
            aria-label={`关闭 ${tab.title}`}
            onclick={() => void closeTab(tab)}
          >
            <X size={13} />
          </button>
        </div>
      {/each}

      <Button
        variant="ghost"
        size="icon-sm"
        class="shrink-0 text-[#5f6673] hover:bg-[#eef1f5]"
        aria-label="新建标签页"
        title={activeSession ? '新建标签页' : '请先选择登录账号'}
        disabled={!activeSession || openingSessionTab}
        onclick={() => void openNewTabForActiveSession()}
      >
        {#if openingSessionTab}
          <Spinner class="size-4" />
        {:else}
          <Plus size={17} strokeWidth={1.8} />
        {/if}
      </Button>
    </div>

    <div class="flex min-w-0 shrink-0 items-center gap-2" aria-label="当前登录账号">
      <div
        class="grid h-10 w-[clamp(220px,19vw,300px)] grid-cols-[20px_minmax(0,1fr)_20px] items-center rounded-[10px] border border-primary bg-white px-3 text-sm text-[#242936]"
        title={activeSession?.label ?? (activeTab ? '正在登录' : '未选择账号')}
      >
        <span aria-hidden="true"></span>
        <span class="truncate text-center font-medium">
          {activeSession?.label ?? (activeTab ? '正在登录' : '未选择账号')}
        </span>
        <VolumeX class="justify-self-end text-[#69707d]" size={16} strokeWidth={1.7} />
      </div>

      {#if activeChannel}
        <AccountSwitcherDialog
          channel={activeChannel}
          sessions={activeSessions}
          {activeSession}
          activeTabId={activeTab?.id}
          onSelectSession={switchLoginSession}
          onNewLogin={newLoginForActiveChannel}
        />
      {/if}
    </div>
  </div>

  <section class="relative min-h-0 bg-secondary" {@attach browserViewport} data-browser-viewport>
    {#if !activeTab}
      <div
        class="grid h-full place-items-center text-sm text-muted-foreground"
        transition:enter={SURFACE_TRANSITION_OPTIONS}
      >
        {cookiePrompt ? '导入 Cookie 后开始使用' : '点击右上角账号按钮选择登录账号'}
      </div>
    {/if}
  </section>
</main>

{#if cookiePrompt}
  <aside
    class="fixed right-6 bottom-6 z-40 w-[340px] rounded-lg border border-border bg-card p-5 shadow-xl"
    aria-live="polite"
    transition:enter={SURFACE_TRANSITION_OPTIONS}
  >
    <div class="flex gap-3">
      <Import class="mt-0.5 shrink-0 text-primary" size={20} strokeWidth={1.8} />
      <div>
        <h2 class="m-0 text-sm font-semibold">导入已有浏览器 Cookie</h2>
        <p class="mt-2 mb-0 text-xs leading-5 text-muted-foreground">
          从本机浏览器自动导入，导入后将在 OTA 页面生效。
        </p>
      </div>
    </div>
    <div class="mt-4 flex justify-end gap-2">
      <Button variant="ghost" size="sm" onclick={() => void finishCookiePrompt()}>暂不导入</Button>
      <CookieImportDialog
        triggerLabel="导入 Cookie"
        triggerSize="sm"
        onComplete={finishCookiePromptAndReviewImports}
      />
    </div>
  </aside>
{/if}
