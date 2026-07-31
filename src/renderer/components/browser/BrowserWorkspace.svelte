<script lang="ts">
  import { onMount } from 'svelte';
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import Import from '@lucide/svelte/icons/import';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import RotateCw from '@lucide/svelte/icons/rotate-cw';
  import X from '@lucide/svelte/icons/x';
  import type { BrowserTab } from '../../../shared/browser';
  import { OTA_CHANNELS, type OtaChannel } from '../../data/ota-channels';
  import { Button } from '$lib/components/ui/button';

  const COOKIE_PROMPT_KEY = 'hotel-butler.cookie-import-prompted';
  let activeChannelId = $state(OTA_CHANNELS[0].id);
  let activeTabIds = $state<Record<string, string>>({});
  let tabsByChannel = $state<Record<string, BrowserTab[]>>({});
  let viewport: HTMLElement;
  let cookiePrompt = $state(false);
  let importMessage = $state('');
  let browserError = $state('');
  let activeTabs = $derived(tabsByChannel[activeChannelId] ?? []);
  let activeTab = $derived(
    activeTabs.find((tab) => tab.id === activeTabIds[activeChannelId]) ?? activeTabs[0],
  );

  function updateTab(next: BrowserTab): void {
    const tabs = tabsByChannel[next.channelId] ?? [];
    const index = tabs.findIndex((tab) => tab.id === next.id);
    tabsByChannel[next.channelId] =
      index === -1 ? [...tabs, next] : tabs.map((tab) => (tab.id === next.id ? next : tab));
    if (index === -1 || !activeTabIds[next.channelId]) activeTabIds[next.channelId] = next.id;
  }

  async function createTab(channel: OtaChannel, url = channel.url): Promise<void> {
    try {
      browserError = '';
      const tab = await window.hotelButler.browser.create(channel.id, url);
      updateTab(tab);
      activeTabIds[channel.id] = tab.id;
      await syncBounds();
    } catch (error) {
      browserError = error instanceof Error ? error.message : '页面打开失败';
    }
  }

  async function selectChannel(channel: OtaChannel): Promise<void> {
    activeChannelId = channel.id;
    const tabId = activeTabIds[channel.id];
    if (tabId) {
      await window.hotelButler.browser.activate(tabId);
      await syncBounds();
    } else if (!cookiePrompt) {
      await createTab(channel);
    }
  }

  async function selectTab(tab: BrowserTab): Promise<void> {
    activeTabIds[tab.channelId] = tab.id;
    await window.hotelButler.browser.activate(tab.id);
    await syncBounds();
  }

  async function closeTab(tab: BrowserTab): Promise<void> {
    const tabs = tabsByChannel[tab.channelId] ?? [];
    const index = tabs.findIndex((item) => item.id === tab.id);
    await window.hotelButler.browser.close(tab.id);
    const nextTabs = tabs.filter((item) => item.id !== tab.id);
    tabsByChannel[tab.channelId] = nextTabs;
    if (activeTabIds[tab.channelId] === tab.id) {
      const next = nextTabs[Math.min(index, nextTabs.length - 1)];
      if (next) {
        activeTabIds[tab.channelId] = next.id;
        await window.hotelButler.browser.activate(next.id);
      } else {
        delete activeTabIds[tab.channelId];
      }
    }
  }

  async function syncBounds(): Promise<void> {
    if (!viewport) return;
    const bounds = viewport.getBoundingClientRect();
    await window.hotelButler.browser.setBounds({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    });
  }

  async function finishCookiePrompt(): Promise<void> {
    localStorage.setItem(COOKIE_PROMPT_KEY, 'true');
    cookiePrompt = false;
    await createTab(OTA_CHANNELS[0]);
  }

  async function importCookies(): Promise<void> {
    try {
      const result = await window.hotelButler.cookies.import();
      if (result.cancelled) return;
      importMessage = `已导入 ${result.imported} 个 Cookie${result.failed ? `，${result.failed} 个失败` : ''}`;
      await finishCookiePrompt();
    } catch (error) {
      importMessage = error instanceof Error ? error.message : 'Cookie 导入失败';
    }
  }

  onMount(() => {
    let mounted = true;
    const unsubscribe = window.hotelButler.browser.onStateChanged((tab) => {
      updateTab(tab);
    });
    const observer = new ResizeObserver(() => void syncBounds());
    observer.observe(viewport);
    window.addEventListener('resize', syncBounds);
    cookiePrompt = localStorage.getItem(COOKIE_PROMPT_KEY) !== 'true';
    if (!cookiePrompt) {
      void window.hotelButler.browser.list().then(async (tabs) => {
        if (!mounted) return;
        for (const tab of tabs) updateTab(tab);
        const ctripTab = tabs.find((tab) => tab.channelId === OTA_CHANNELS[0].id);
        if (ctripTab) {
          activeTabIds[ctripTab.channelId] = ctripTab.id;
          await window.hotelButler.browser.activate(ctripTab.id);
          await syncBounds();
        } else {
          await createTab(OTA_CHANNELS[0]);
        }
      });
    }
    return () => {
      mounted = false;
      void window.hotelButler.browser.hide();
      unsubscribe();
      observer.disconnect();
      window.removeEventListener('resize', syncBounds);
    };
  });
</script>

<main class="grid h-full min-h-0 grid-rows-[62px_48px_minmax(0,1fr)] bg-background">
  <nav
    class="flex min-w-0 items-center gap-1 overflow-x-auto border-b border-border px-4"
    aria-label="OTA 快捷入口"
  >
    {#each OTA_CHANNELS as channel (channel.id)}
      <button
        class={[
          'flex h-9 shrink-0 items-center gap-2 rounded-md px-3 text-[13px] font-medium transition-colors',
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
        onclick={() => activeTab && void window.hotelButler.browser.goBack(activeTab.id)}
      >
        <ArrowLeft size={16} strokeWidth={1.8} />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="前进"
        disabled={!activeTab?.canGoForward}
        onclick={() => activeTab && void window.hotelButler.browser.goForward(activeTab.id)}
      >
        <ArrowRight size={16} strokeWidth={1.8} />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="刷新"
        disabled={!activeTab}
        onclick={() => activeTab && void window.hotelButler.browser.reload(activeTab.id)}
      >
        <RotateCw
          class={activeTab?.loading ? 'animate-spin' : undefined}
          size={16}
          strokeWidth={1.8}
        />
      </Button>
    </nav>

    <div
      class="flex min-w-0 flex-1 items-end gap-1 self-stretch overflow-x-auto pt-1.5"
      role="tablist"
      aria-label="已打开页面"
    >
      {#each activeTabs as tab (tab.id)}
        <div
          class={[
            'group flex h-[41px] min-w-32 max-w-56 items-center rounded-t-md border border-b-0 text-xs',
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
            {#if tab.loading}<LoaderCircle class="shrink-0 animate-spin" size={13} />{/if}
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
      <div class="grid h-full place-items-center text-sm text-muted-foreground">
        {cookiePrompt ? '导入 Cookie 后开始使用' : '点击上方快捷入口打开平台'}
      </div>
    {/if}
    {#if browserError}
      <p
        class="absolute top-4 left-1/2 -translate-x-1/2 rounded-md bg-destructive px-4 py-2 text-sm text-white"
      >
        {browserError}
      </p>
    {/if}
  </section>
</main>

{#if cookiePrompt}
  <aside
    class="fixed right-6 bottom-6 z-40 w-[340px] rounded-lg border border-border bg-card p-5 shadow-xl"
    aria-live="polite"
  >
    <div class="flex gap-3">
      <Import class="mt-0.5 shrink-0 text-primary" size={20} strokeWidth={1.8} />
      <div>
        <h2 class="m-0 text-sm font-semibold">导入已有浏览器 Cookie</h2>
        <p class="mt-2 mb-0 text-xs leading-5 text-muted-foreground">
          支持浏览器扩展导出的 JSON 或 Netscape Cookie 文件。导入后将在 OTA 页面自动生效。
        </p>
      </div>
    </div>
    {#if importMessage}<p class="mt-3 mb-0 text-xs text-destructive">{importMessage}</p>{/if}
    <div class="mt-4 flex justify-end gap-2">
      <Button variant="ghost" size="sm" onclick={() => void finishCookiePrompt()}>暂不导入</Button>
      <Button size="sm" onclick={() => void importCookies()}>选择文件</Button>
    </div>
  </aside>
{/if}
