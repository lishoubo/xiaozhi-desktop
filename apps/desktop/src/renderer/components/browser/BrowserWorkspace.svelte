<script lang="ts">
  import { autoAnimate } from '@formkit/auto-animate';
  import { onMount } from 'svelte';
  import log from 'electron-log/renderer';
  import { errorFields } from '../../logging';
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import Plus from '@lucide/svelte/icons/plus';
  import RotateCw from '@lucide/svelte/icons/rotate-cw';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
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
  import { tabActivation } from './cross-route-intents';
  import { displayTabTitle } from './tab-title';
  import { Button } from '$lib/components/ui/button';
  import { Spinner } from '$lib/components/ui/spinner';
  import AccountSwitcherDialog from './AccountSwitcherDialog.svelte';
  import BindHotelDialog from './BindHotelDialog.svelte';
  import ReauthDialog from './ReauthDialog.svelte';
  import {
    buildLoginCredentialOptions,
    currentLoginCredential,
    type LoginCredentialOption,
  } from './login-credential-options';
  import channelLoginIllustrationUrl from '../../assets/channel-login-illustration.png';

  // 顶部入口只列已接通监听与探测的渠道；`OTA_CHANNELS` 仍是完整字典，负责把历史
  // 绑定记录里的 `source` 翻译成中文名（理由见 `WORKSPACE_CHANNEL_IDS`）。
  const workspaceChannels = OTA_CHANNELS.filter((channel) =>
    WORKSPACE_CHANNEL_IDS.includes(channel.id),
  );
  // 标签页状态归 `browserOtaTabs`（渲染进程侧的 OTA tab 状态层）；本组件只渲染
  // 它、并把视口尺寸注册进去。凭证列表不属于 tab 状态，仍留在本地。
  let credentialsByChannel = $state<Record<string, OtaCredentialDto[]>>({});
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
    // 17 处弹窗共用这一个出口，界面文案又统一是「页面操作失败」——不带上当前
    // 标签页的上下文，日志里就只剩 event 名可分辨。
    log.warn(event, {
      partitionName: activeTab?.partitionName,
      channelId: activeTab?.channelId,
      ...errorFields(reason),
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

  /** 就地重新加载某个标签页（故障恢复入口，不要求它是当前激活的那个）。 */
  async function reloadTab(tab: BrowserTab): Promise<void> {
    dismissAppNotification('browser-operation-error');
    try {
      await window.hotelButler.browser.reload(tab.id);
    } catch (error) {
      reportBrowserFailure('Browser tab could not be reloaded', '页面重新加载失败，请重试', error);
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
    // 网页自己开的标签页（`window.open`）。主进程只建不激活，收尾由这里做——
    // 与用户点「新建标签页」走的是同一条路。
    const unsubscribeTabOpened = window.hotelButler.browser.onTabOpened((tab) => {
      void browserOtaTabs.adoptOpenedByPage(tab).catch((error: unknown) => {
        if (mounted) {
          reportBrowserFailure(
            'Page-opened tab could not be adopted',
            '新标签页打开失败，请重试',
            error,
          );
        }
      });
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
      void browserOtaTabs.adopt(pendingTab).catch((error: unknown) => {
        if (mounted) {
          reportBrowserFailure('Pending tab could not be activated', '标签激活失败，请重试', error);
        }
      });
    } else {
      void loadCredentials(activeChannelId);
      void window.hotelButler.browser
        .list()
        .then(async (tabs) => {
          if (!mounted) return;
          browserOtaTabs.hydrate(tabs);
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
          ...errorFields(error),
        });
      });
      unsubscribe();
      unsubscribeTabOpened();
      unsubscribeDiscoveryCompleted();
      observer.disconnect();
      resizeObserver = undefined;
      window.removeEventListener('resize', syncBounds);
    };
  });
</script>

<main
  class="grid h-full min-h-0 grid-rows-[74px_72px_minmax(0,1fr)] bg-background"
  data-motion="page"
  in:enter={{ ...PAGE_ENTER_OPTIONS, y: 0 }}
>
  <nav
    class="flex min-w-0 items-center gap-3 overflow-x-auto border-b border-[#e9edf0] bg-white px-5"
    aria-label="OTA 快捷入口"
  >
    {#each workspaceChannels as channel (channel.id)}
      <button
        class={[
          'flex h-[46px] min-w-[132px] shrink-0 items-center justify-center gap-2 rounded-[9px] border px-3 text-sm font-medium whitespace-nowrap shadow-xs transition-[background-color,border-color,color] duration-150 ease-out',
          activeChannelId === channel.id
            ? 'border-[#58bdb8] bg-[#edf8f7] text-[#078f8a]'
            : 'border-[#e1e5e9] bg-white text-[#596576] hover:border-[#acd3d1] hover:bg-[#f7fbfa]',
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
    class="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-[#edf0f2] bg-background px-5"
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
      class="flex h-11 min-w-0 items-center rounded-[10px] border border-[#e0e5e9] bg-[#f7f9fa] p-1 shadow-[0_1px_2px_rgba(16,24,40,.025)]"
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
          <!-- 标题一律走 displayTabTitle：标签文字与辅助文本同一个来源，否则
               「关闭 ${tab.title}」在加载中会读成「关闭 正在加载…」。
               刻意**不加** title 属性做 tooltip：悬停弹层在标签栏上扫过时会一路
               弹出来，比截断本身更烦人（产品决策，2026-08-21）。 -->
          {@const tabTitle = displayTabTitle(tab)}
          <div
            class={[
              // flex-1 + basis 让标签数量少时占更大宽度（标题能多显示几个字），
              // 多起来再各自收缩到 min-w；max-w 仍然封顶，避免一个标签独占整条。
              'group flex h-8 min-w-[132px] max-w-[240px] flex-1 basis-[200px] items-center rounded-lg border text-xs transition-[background-color,border-color,color,box-shadow] duration-150 ease-out motion-reduce:transition-none',
              tab.failure
                ? 'border-destructive/40 bg-destructive/5 text-destructive'
                : activeTab?.id === tab.id
                  ? 'border-[#e2e6ec] bg-white text-[#242936] shadow-sm'
                  : 'border-transparent text-[#5f6673] hover:bg-[#e8ebef] hover:text-[#242936]',
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
                <Spinner class="size-[13px] shrink-0" aria-label={`${tabTitle}正在加载`} />
              {:else if tab.failure}
                <TriangleAlert class="shrink-0" size={13} strokeWidth={2} aria-hidden="true" />
              {/if}
              <span class="min-w-0 flex-1 truncate">{tabTitle}</span>
            </button>
            {#if tab.failure}
              <!-- 故障标签页需要一个**就地**的恢复入口：顶部那个刷新按钮只作用于
                   当前激活的标签页，崩掉的那个未必是它。 -->
              <button
                class="grid size-6 shrink-0 place-items-center rounded hover:bg-destructive/15"
                type="button"
                aria-label={`重新加载 ${tabTitle}`}
                title="重新加载"
                onclick={() => void reloadTab(tab)}
              >
                <RotateCw size={13} />
              </button>
            {/if}
            <button
              class="mr-1 grid size-6 shrink-0 place-items-center rounded hover:bg-black/10"
              type="button"
              aria-label={`关闭 ${tabTitle}`}
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
        class="grid h-10 w-[clamp(150px,16vw,214px)] grid-cols-[28px_minmax(0,1fr)_28px] items-center rounded-[9px] border border-[#dbe2e9] bg-card px-1.5 text-[13px] text-foreground shadow-xs transition-colors hover:border-[#9bd7d4]"
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

  <section class="relative min-h-0 bg-[#f6f8f9]" {@attach browserViewport} data-browser-viewport>
    {#if !activeTab}
      <div
        class="flex h-full flex-col items-center justify-center px-8 text-center"
        transition:enter={SURFACE_TRANSITION_OPTIONS}
      >
        <img
          class="mb-1 h-[190px] w-[330px] max-w-full object-contain saturate-[.78]"
          src={channelLoginIllustrationUrl}
          alt="浏览器安全登录插画"
        />
        <h2 class="m-0 text-[21px] font-semibold tracking-[-0.025em]">选择上方渠道，开始登录</h2>
        <p class="mt-3 mb-0 text-sm text-muted-foreground">
          选择右上角账号后，系统将自动同步渠道登录状态
        </p>
      </div>
    {/if}
  </section>
</main>

<BindHotelDialog />
<ReauthDialog />

