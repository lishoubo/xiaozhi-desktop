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
  import Volume2 from '@lucide/svelte/icons/volume-2';
  import VolumeX from '@lucide/svelte/icons/volume-x';
  import X from '@lucide/svelte/icons/x';
  import type { BrowserTab, OtaCredentialDto } from '../../../shared/browser';
  import {
    enter,
    LAYOUT_ANIMATION_OPTIONS,
    PAGE_ENTER_OPTIONS,
    SURFACE_TRANSITION_OPTIONS,
  } from '../../motion';
  import { OTA_CHANNELS, WORKSPACE_CHANNEL_IDS, type OtaChannel } from '../../data/ota-channels';
  import { dismissAppNotification, showAppNotification } from '../../notifications';
  import { browserOtaTabs } from './browser-ota-tabs.svelte';
  import { cookieListAutoOpen, tabActivation } from './cross-route-intents';
  import { Button } from '$lib/components/ui/button';
  import { Spinner } from '$lib/components/ui/spinner';
  import AccountSwitcherDialog from './AccountSwitcherDialog.svelte';
  import BindHotelDialog from './BindHotelDialog.svelte';
  import ReauthDialog from './ReauthDialog.svelte';
  import CookieImportDialog from './CookieImportDialog.svelte';
  import {
    buildLoginCredentialOptions,
    currentLoginCredential,
    type LoginCredentialOption,
  } from './login-credential-options';

  const COOKIE_PROMPT_KEY = 'hotel-butler.cookie-import-prompted';
  // 顶部入口只列已接通监听与探测的渠道；`OTA_CHANNELS` 仍是完整字典，负责把历史
  // 绑定记录里的 `source` 翻译成中文名（理由见 `WORKSPACE_CHANNEL_IDS`）。
  const workspaceChannels = OTA_CHANNELS.filter((channel) =>
    WORKSPACE_CHANNEL_IDS.includes(channel.id),
  );
  // 标签页状态归 `browserOtaTabs`（渲染进程侧的 OTA tab 状态层）；本组件只渲染
  // 它、并把视口尺寸注册进去。凭证列表不属于 tab 状态，仍留在本地。
  let credentialsByChannel = $state<Record<string, OtaCredentialDto[]>>({});
  let cookiePrompt = $state(false);
  let openingSessionTab = $state(false);
  let audioMuted = $state(false);
  let audioStateReady = $state(false);
  let updatingAudioMuted = $state(false);
  let viewportNode: HTMLElement | undefined;
  let resizeObserver: ResizeObserver | undefined;
  let activeChannelId = $derived(browserOtaTabs.activeChannelId);
  let activeTabs = $derived(browserOtaTabs.activeTabs);
  let activeTab = $derived(browserOtaTabs.activeTab);
  let activeCredentials = $derived(credentialsByChannel[activeChannelId] ?? []);
  let activeChannel = $derived(OTA_CHANNELS.find((item) => item.id === activeChannelId));
  let activeCredentialOptions = $derived(
    buildLoginCredentialOptions(activeCredentials, activeTab?.partitionName),
  );
  let activeCredential = $derived(
    currentLoginCredential(activeCredentialOptions, activeTab?.partitionName),
  );

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

  async function createTab(channel: OtaChannel, url = channel.url): Promise<BrowserTab | null> {
    try {
      dismissAppNotification('browser-operation-error');
      return await browserOtaTabs.openForNewLogin(channel.id, url);
    } catch (error) {
      reportBrowserFailure('Browser tab could not be created', '页面打开失败，请重试', error);
      return null;
    }
  }

  async function loadCredentials(channelId: string): Promise<void> {
    try {
      credentialsByChannel[channelId] =
        await window.hotelButler.otaCredential.listByChannel(channelId);
    } catch (error) {
      reportBrowserFailure(
        'Ota credentials could not be loaded',
        '登录凭据列表加载失败，请重试',
        error,
      );
    }
  }

  async function selectChannel(channel: OtaChannel): Promise<void> {
    dismissAppNotification('browser-operation-error');
    void loadCredentials(channel.id);
    try {
      await browserOtaTabs.selectChannel(channel.id);
    } catch (error) {
      reportBrowserFailure('Browser channel could not be selected', '渠道切换失败，请重试', error);
    }
  }

  async function openExistingCredentialTab(
    credential: OtaCredentialDto,
  ): Promise<BrowserTab | null> {
    dismissAppNotification('browser-operation-error');
    try {
      return await browserOtaTabs.openExisting(credential.id);
    } catch (error) {
      reportBrowserFailure(
        'Ota credential tab could not be opened',
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
    await browserOtaTabs.closeSuperseded(channelId, targetPartitionName, previousTabs, (error) =>
      reportBrowserFailure(
        'Superseded browser tab could not be closed',
        '旧账号页面关闭失败，请手动关闭',
        error,
      ),
    );
  }

  async function openNewTabForActiveSession(): Promise<void> {
    if (!activeCredential || openingSessionTab) return;
    openingSessionTab = true;
    try {
      await openExistingCredentialTab(activeCredential.credential);
    } finally {
      openingSessionTab = false;
    }
  }

  async function switchLoginCredential(credential: LoginCredentialOption): Promise<boolean> {
    const previousTabs = [...activeTabs];
    const alreadyOpen = previousTabs.find((tab) => tab.partitionName === credential.partitionName);
    let targetTab = alreadyOpen;

    if (targetTab) {
      try {
        await browserOtaTabs.activate(targetTab);
      } catch (error) {
        reportBrowserFailure(
          'Existing account tab could not be activated',
          '账号切换失败，请重试',
          error,
        );
        return false;
      }
    } else {
      targetTab = (await openExistingCredentialTab(credential.credential)) ?? undefined;
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

  async function loginFromImportedCookiesForActiveChannel(): Promise<boolean> {
    const channel = OTA_CHANNELS.find((item) => item.id === activeChannelId);
    if (!channel) return false;
    const previousTabs = [...activeTabs];
    dismissAppNotification('browser-operation-error');
    try {
      const tab = await browserOtaTabs.openWithImportedCookie(channel.id, channel.url);
      await closeSupersededTabs(tab.channelId, tab.partitionName, previousTabs);
      return true;
    } catch (error) {
      reportBrowserFailure(
        'Imported cookies could not open the active channel',
        `未在导入结果中找到可用的${channel.name}登录态`,
        error,
      );
      return false;
    }
  }

  async function selectTab(tab: BrowserTab): Promise<void> {
    dismissAppNotification('browser-operation-error');
    try {
      await browserOtaTabs.activate(tab);
    } catch (error) {
      reportBrowserFailure('Browser tab could not be selected', '标签切换失败，请重试', error);
    }
  }

  async function closeTab(tab: BrowserTab): Promise<void> {
    dismissAppNotification('browser-operation-error');
    try {
      await browserOtaTabs.close(tab);
    } catch (error) {
      reportBrowserFailure('Browser tab could not be closed', '标签关闭失败，请重试', error);
    }
  }

  async function syncBounds(): Promise<void> {
    try {
      await browserOtaTabs.syncBounds();
    } catch (error) {
      reportBrowserFailure(
        'Browser viewport could not be synchronized',
        '页面区域同步失败，请调整窗口后重试',
        error,
      );
    }
  }

  /**
   * 把视口交给 store —— 只有渲染进程拿得到这个几何信息。同时留一份本地引用给
   * `ResizeObserver`（视口尺寸变化要重新同步 WebContentsView）。
   */
  function browserViewport(node: HTMLElement): () => void {
    viewportNode = node;
    resizeObserver?.observe(node);
    const unregister = browserOtaTabs.registerViewport(() => node.getBoundingClientRect());
    return () => {
      if (viewportNode === node) viewportNode = undefined;
      resizeObserver?.unobserve(node);
      unregister();
    };
  }

  function finishCookiePrompt(): void {
    cookiePrompt = false;
    localStorage.setItem(COOKIE_PROMPT_KEY, 'true');
    // 引导页让开后内容区才真正可见，此刻补上挂载时跳过的那次激活。
    // 已经有标签页时才做——刚导入 cookie 那条路会自己开标签并 adopt，
    // `activateIfIdle` 会让位给它。
    const target = browserOtaTabs.restoreTarget(browserOtaTabs.allTabs);
    if (target) {
      void browserOtaTabs.activateIfIdle(target).catch((error: unknown) => {
        log.warn('Tab could not be activated after the cookie prompt', {
          errorName: error instanceof Error ? error.name : 'UnknownError',
        });
      });
    }
  }

  async function finishCookiePromptAndReviewImports(): Promise<void> {
    finishCookiePrompt();
    cookieListAutoOpen.set(true);
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

  async function toggleAudioMuted(): Promise<void> {
    if (updatingAudioMuted) return;
    updatingAudioMuted = true;
    try {
      audioMuted = await window.hotelButler.browser.setAudioMuted(!audioMuted);
    } catch (error) {
      reportBrowserFailure(
        'Browser audio state could not be changed',
        '网页声音切换失败，请重试',
        error,
      );
    } finally {
      updatingAudioMuted = false;
    }
  }

  onMount(() => {
    let mounted = true;
    void window.hotelButler.browser
      .getAudioMuted()
      .then((muted) => {
        if (mounted) audioMuted = muted;
      })
      .catch((error: unknown) => {
        if (mounted) {
          reportBrowserFailure(
            'Browser audio state could not be loaded',
            '网页声音状态读取失败，请重试',
            error,
          );
        }
      })
      .finally(() => {
        if (mounted) audioStateReady = true;
      });
    const unsubscribe = window.hotelButler.browser.onStateChanged((tab) => {
      browserOtaTabs.updateTab(tab);
    });
    const unsubscribeDiscoveryCompleted = window.hotelButler.otaCredential.onDiscoveryCompleted(
      ({ channel }) => {
        if (channel === activeChannelId) void loadCredentials(channel);
      },
    );
    const observer = new ResizeObserver(() => void syncBounds());
    resizeObserver = observer;
    if (viewportNode) observer.observe(viewportNode);
    window.addEventListener('resize', syncBounds);
    const pendingTab = tabActivation.consume();
    if (pendingTab) {
      void loadCredentials(pendingTab.channelId);
      cookiePrompt = false;
      void browserOtaTabs.adopt(pendingTab).catch((error: unknown) => {
        if (mounted) {
          reportBrowserFailure('Pending tab could not be activated', '标签激活失败，请重试', error);
        }
      });
    } else {
      void loadCredentials(activeChannelId);
      cookiePrompt = localStorage.getItem(COOKIE_PROMPT_KEY) !== 'true';
      // ⚠️ 不论引导页在不在都要 hydrate：标签栏依赖它才画得出来。此前整段被
      // `if (!cookiePrompt)` 包着，导致**引导页出现过的那一次**标签状态从未装载，
      // 关掉引导页后标签栏是空的、内容区也没人激活——用户点一下标签才恢复。
      // 引导页只在首次出现，所以这个 case「只有第一次能复现」。
      void window.hotelButler.browser
        .list()
        .then(async (tabs) => {
          if (!mounted) return;
          browserOtaTabs.hydrate(tabs);
          // 引导页盖着内容区时不激活：此刻激活等于把网页画到引导页底下，
          // 用户关掉引导页才看得见。留给 `finishCookiePrompt` 那条路去做。
          if (cookiePrompt) return;
          // 兜底激活：带着绑定意图进来时，标签页由 BindHotelDialog 那条链开，
          // 它先起跑但后完成——这里必须让位，否则会把它从内容区顶掉。
          //
          // 目标是「用户上次看的那个」而非固定的第一个渠道，理由见 `restoreTarget`。
          const target = browserOtaTabs.restoreTarget(tabs);
          if (target) await browserOtaTabs.activateIfIdle(target);
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
    return () => {
      mounted = false;
      browserOtaTabs.releaseViewportSession();
      void Promise.resolve(window.hotelButler.browser.hide()).catch((error: unknown) => {
        log.warn('Browser workspace could not be hidden', {
          errorName: error instanceof Error ? error.name : 'UnknownError',
        });
      });
      unsubscribe();
      unsubscribeDiscoveryCompleted();
      observer.disconnect();
      resizeObserver = undefined;
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
    class="flex min-w-0 items-center gap-1 overflow-x-auto border-b border-border bg-muted px-4"
    aria-label="OTA 快捷入口"
  >
    {#each workspaceChannels as channel (channel.id)}
      <button
        class={[
          'flex h-10 shrink-0 items-center justify-center gap-[7px] rounded-lg border px-2.5 text-sm font-medium whitespace-nowrap transition-[background-color,border-color,color,box-shadow] duration-150 ease-out motion-reduce:transition-none',
          activeChannelId === channel.id
            ? 'border-border bg-card text-foreground shadow-sm'
            : 'border-transparent text-muted-foreground hover:bg-background hover:text-foreground',
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
    class="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-border bg-background px-4"
  >
    <nav class="flex shrink-0 items-center gap-1" aria-label="页面控制">
      <Button
        variant="ghost"
        size="icon-sm"
        class="text-muted-foreground hover:bg-muted"
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
        class="text-muted-foreground hover:bg-muted"
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
        class="text-muted-foreground hover:bg-muted"
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
      <span class="ml-2 h-6 w-px bg-border" aria-hidden="true"></span>
    </nav>

    <div
      class="flex h-10 min-w-0 items-center rounded-lg bg-muted p-1"
      role="group"
      aria-label="页面标签区"
    >
      <div
        class="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="tablist"
        aria-label="已打开页面"
        use:autoAnimate={LAYOUT_ANIMATION_OPTIONS}
      >
        {#each activeTabs as tab (tab.id)}
          <div
            class={[
              'group flex h-8 min-w-[132px] max-w-[200px] items-center rounded-lg border text-xs transition-[background-color,border-color,color,box-shadow] duration-150 ease-out motion-reduce:transition-none',
              activeTab?.id === tab.id
                ? 'border-border bg-card text-foreground shadow-sm'
                : 'border-transparent text-muted-foreground hover:bg-background/70 hover:text-foreground',
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
      </div>

      <Button
        variant="ghost"
        size="icon-sm"
        class="ml-1 shrink-0 text-muted-foreground hover:bg-background"
        aria-label="新建标签页"
        title={activeCredential ? '新建标签页' : '请先选择登录账号'}
        disabled={!activeCredential || openingSessionTab}
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
        class="grid h-9 w-[clamp(136px,15vw,196px)] grid-cols-[28px_minmax(0,1fr)_28px] items-center rounded-md border border-[var(--brand-green-deep)] bg-card px-1.5 text-sm text-foreground shadow-xs"
        title={activeCredential?.label ?? activeChannel?.name ?? '未选择渠道'}
      >
        <span aria-hidden="true"></span>
        <span class="truncate text-center font-medium">
          {activeCredential?.label ?? activeChannel?.name ?? '未选择渠道'}
        </span>
        <button
          class="grid size-7 place-items-center justify-self-end rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
          type="button"
          aria-label={audioMuted ? '开启网页声音' : '关闭网页声音'}
          aria-pressed={audioMuted}
          title={audioMuted ? '开启网页声音' : '关闭网页声音'}
          disabled={!audioStateReady || updatingAudioMuted}
          onclick={() => void toggleAudioMuted()}
        >
          {#if audioMuted}
            <VolumeX size={15} strokeWidth={1.7} />
          {:else}
            <Volume2 size={15} strokeWidth={1.7} />
          {/if}
        </button>
      </div>

      {#if activeChannel}
        <AccountSwitcherDialog
          channel={activeChannel}
          credentials={activeCredentialOptions}
          {activeCredential}
          activeTabId={activeTab?.id}
          onSelectCredential={switchLoginCredential}
          onCookieImport={loginFromImportedCookiesForActiveChannel}
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

<BindHotelDialog />
<ReauthDialog />

{#if cookiePrompt}
  <aside
    class="fixed right-6 bottom-6 z-40 w-[340px] rounded-lg border border-border bg-card p-5 shadow-xl"
    aria-live="polite"
    transition:enter={SURFACE_TRANSITION_OPTIONS}
  >
    <div class="flex gap-3">
      <Import class="mt-0.5 shrink-0 text-[var(--brand-green-deep)]" size={20} strokeWidth={1.8} />
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
