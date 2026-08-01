<script lang="ts">
  import { autoAnimate } from '@formkit/auto-animate';
  import { onMount } from 'svelte';
  import log from 'electron-log/renderer';
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import CircleAlert from '@lucide/svelte/icons/circle-alert';
  import Import from '@lucide/svelte/icons/import';
  import RotateCw from '@lucide/svelte/icons/rotate-cw';
  import X from '@lucide/svelte/icons/x';
  import type { BrowserTab } from '../../../shared/browser';
  import {
    ALERT_ANIMATION_OPTIONS,
    enter,
    LAYOUT_ANIMATION_OPTIONS,
    PAGE_ENTER_OPTIONS,
    SURFACE_TRANSITION_OPTIONS,
  } from '../../motion';
  import { OTA_CHANNELS, type OtaChannel } from '../../data/ota-channels';
  import { Button } from '$lib/components/ui/button';
  import { Spinner } from '$lib/components/ui/spinner';
  import * as Alert from '$lib/components/ui/alert';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import CookieImportDialog from './CookieImportDialog.svelte';

  const COOKIE_PROMPT_KEY = 'hotel-butler.cookie-import-prompted';
  let activeChannelId = $state(OTA_CHANNELS[0].id);
  let activeTabIds = $state<Record<string, string>>({});
  let tabsByChannel = $state<Record<string, BrowserTab[]>>({});
  let viewport: HTMLElement;
  let cookiePrompt = $state(false);
  let browserError = $state('');
  let interceptionAlertOpen = $state(false);
  let activeTabs = $derived(tabsByChannel[activeChannelId] ?? []);
  let activeTab = $derived(
    activeTabs.find((tab) => tab.id === activeTabIds[activeChannelId]) ?? activeTabs[0],
  );

  function reportBrowserFailure(event: string, message: string, reason: unknown): void {
    log.warn(event, {
      errorName: reason instanceof Error ? reason.name : 'UnknownError',
    });
    browserError = message;
  }

  function updateTab(next: BrowserTab): void {
    const tabs = tabsByChannel[next.channelId] ?? [];
    const index = tabs.findIndex((tab) => tab.id === next.id);
    tabsByChannel[next.channelId] =
      index === -1 ? [...tabs, next] : tabs.map((tab) => (tab.id === next.id ? next : tab));
    if (index === -1 || !activeTabIds[next.channelId]) activeTabIds[next.channelId] = next.id;
  }

  async function createTab(channel: OtaChannel, url = channel.url): Promise<boolean> {
    try {
      browserError = '';
      const tab = await window.hotelButler.browser.create(channel.id, url);
      updateTab(tab);
      activeTabIds[channel.id] = tab.id;
      await syncBounds();
      return true;
    } catch (error) {
      reportBrowserFailure('Browser tab could not be created', '页面打开失败，请重试', error);
      return false;
    }
  }

  async function selectChannel(channel: OtaChannel): Promise<void> {
    browserError = '';
    activeChannelId = channel.id;
    const tabId = activeTabIds[channel.id];
    try {
      if (tabId) {
        await window.hotelButler.browser.activate(tabId);
        await syncBounds();
      } else if (!cookiePrompt) {
        await createTab(channel);
      }
    } catch (error) {
      reportBrowserFailure('Browser channel could not be selected', '渠道切换失败，请重试', error);
    }
  }

  async function selectTab(tab: BrowserTab): Promise<void> {
    browserError = '';
    try {
      await window.hotelButler.browser.activate(tab.id);
      activeTabIds[tab.channelId] = tab.id;
      await syncBounds();
    } catch (error) {
      reportBrowserFailure('Browser tab could not be selected', '标签切换失败，请重试', error);
    }
  }

  async function closeTab(tab: BrowserTab): Promise<void> {
    browserError = '';
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

  async function finishCookiePrompt(): Promise<void> {
    cookiePrompt = false;
    if (await createTab(OTA_CHANNELS[0])) {
      localStorage.setItem(COOKIE_PROMPT_KEY, 'true');
    }
  }

  async function runNavigationAction(event: string, action: () => Promise<void>): Promise<void> {
    browserError = '';
    try {
      await action();
    } catch (error) {
      reportBrowserFailure(event, '页面操作失败，请重试', error);
    }
  }

  async function acknowledgeInterception(event: MouseEvent): Promise<void> {
    event.preventDefault();
    try {
      await window.hotelButler.browser.acknowledgeInterception();
      interceptionAlertOpen = false;
    } catch (error) {
      reportBrowserFailure(
        'Browser interception could not be acknowledged',
        '页面恢复失败，请重新打开渠道',
        error,
      );
    }
  }

  onMount(() => {
    let mounted = true;
    const unsubscribe = window.hotelButler.browser.onStateChanged((tab) => {
      updateTab(tab);
    });
    const unsubscribeInterception = window.hotelButler.browser.onRequestIntercepted(() => {
      interceptionAlertOpen = true;
    });
    const observer = new ResizeObserver(() => void syncBounds());
    observer.observe(viewport);
    window.addEventListener('resize', syncBounds);
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
          } else {
            await createTab(OTA_CHANNELS[0]);
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
    return () => {
      mounted = false;
      void Promise.resolve(window.hotelButler.browser.hide()).catch((error: unknown) => {
        log.warn('Browser workspace could not be hidden', {
          errorName: error instanceof Error ? error.name : 'UnknownError',
        });
      });
      unsubscribe();
      unsubscribeInterception();
      observer.disconnect();
      window.removeEventListener('resize', syncBounds);
    };
  });
</script>

<main
  class="grid h-full min-h-0 grid-rows-[62px_48px_minmax(0,1fr)] bg-background"
  data-motion="page"
  in:enter={{ ...PAGE_ENTER_OPTIONS, y: 0 }}
>
  <nav
    class="flex min-w-0 items-center gap-1 overflow-x-auto border-b border-border px-4"
    aria-label="OTA 快捷入口"
  >
    {#each OTA_CHANNELS as channel (channel.id)}
      <button
        class={[
          'flex h-9 shrink-0 items-center gap-2 rounded-md px-3 text-[13px] font-medium transition-colors duration-150 ease-out motion-reduce:transition-none',
          activeChannelId === channel.id
            ? 'bg-accent text-accent-foreground'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        ]}
        type="button"
        aria-pressed={activeChannelId === channel.id}
        onclick={() => void selectChannel(channel)}
      >
        <img class="size-4 rounded-sm object-contain" src={channel.iconUrl} alt="" />
        {channel.name}
      </button>
    {/each}
  </nav>

  <div class="flex min-w-0 items-center gap-2 border-b border-border bg-secondary/55 px-3">
    <nav class="flex shrink-0 gap-0.5" aria-label="页面控制">
      <Button
        variant="ghost"
        size="icon"
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
        size="icon"
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
        size="icon"
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
    </nav>

    <div
      class="flex min-w-0 flex-1 items-end gap-1 self-stretch overflow-x-auto pt-1.5"
      role="tablist"
      aria-label="已打开页面"
      use:autoAnimate={LAYOUT_ANIMATION_OPTIONS}
    >
      {#each activeTabs as tab (tab.id)}
        <div
          class={[
            'group flex h-[41px] min-w-32 max-w-56 items-center rounded-t-md border border-b-0 text-xs transition-colors duration-150 ease-out motion-reduce:transition-none',
            activeTab?.id === tab.id
              ? 'border-border bg-background text-foreground'
              : 'border-transparent text-muted-foreground hover:bg-muted',
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
  </div>

  <section class="relative min-h-0 bg-secondary" bind:this={viewport} data-browser-viewport>
    {#if !activeTab}
      <div
        class="grid h-full place-items-center text-sm text-muted-foreground"
        transition:enter={SURFACE_TRANSITION_OPTIONS}
      >
        {cookiePrompt ? '导入 Cookie 后开始使用' : '点击上方快捷入口打开平台'}
      </div>
    {/if}
    <div
      class="pointer-events-none absolute top-4 right-4 z-40 w-[calc(100%-2rem)] max-w-[22rem]"
      use:autoAnimate={ALERT_ANIMATION_OPTIONS}
    >
      {#if browserError}
        <Alert.Root class="shadow-lg" variant="destructive">
          <CircleAlert />
          <Alert.Title>页面操作失败</Alert.Title>
          <Alert.Description>{browserError}</Alert.Description>
        </Alert.Root>
      {/if}
    </div>
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
        onComplete={finishCookiePrompt}
      />
    </div>
  </aside>
{/if}

<AlertDialog.Root bind:open={interceptionAlertOpen}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>请求拦截成功</AlertDialog.Title>
      <AlertDialog.Description>已拦截携程接口请求：/restapi/soa2/**</AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Action onclick={(event) => void acknowledgeInterception(event)}
        >知道了</AlertDialog.Action
      >
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
