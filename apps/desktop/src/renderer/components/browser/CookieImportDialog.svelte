<script lang="ts">
  import log from 'electron-log/renderer';
  import { tick } from 'svelte';
  import type { BrowserCookieSource, BrowserCookieSourceId } from '../../../shared/browser';
  import { enter, SURFACE_TRANSITION_OPTIONS } from '../../motion';
  import { BROWSER_COOKIE_OPTIONS, BROWSER_ICON_URLS } from '../../data/browser-icons';
  import { dismissAppNotification, showAppNotification } from '../../notifications';
  import { Button, type ButtonSize, type ButtonVariant } from '$lib/components/ui/button';
  import { Spinner } from '$lib/components/ui/spinner';
  import * as Dialog from '$lib/components/ui/dialog';

  let {
    triggerLabel,
    triggerVariant = 'default',
    triggerSize = 'default',
    showSuccessNotification = false,
    onComplete = () => undefined,
  }: {
    triggerLabel: string;
    triggerVariant?: ButtonVariant;
    triggerSize?: ButtonSize;
    showSuccessNotification?: boolean;
    onComplete?: () => void | Promise<void>;
  } = $props();

  let open = $state(false);
  let sources = $state<BrowserCookieSource[]>([]);
  let selectedSourceId = $state<BrowserCookieSourceId | null>(null);
  let step = $state<'select' | 'importing'>('select');
  let loadingSources = $state(false);

  function sourceAvailable(sourceId: BrowserCookieSourceId): boolean {
    return sources.some((item) => item.id === sourceId);
  }

  async function openDialog(): Promise<void> {
    dismissAppNotification('cookie-sources-error');
    dismissAppNotification('cookie-import-error');
    open = true;
    step = 'select';
    sources = [];
    selectedSourceId = null;
    loadingSources = true;
    try {
      sources = await window.hotelButler.cookies.listSources();
      selectedSourceId = sources[0]?.id ?? null;
    } catch (reason) {
      log.warn('Browser cookie sources could not be detected', {
        errorName: reason instanceof Error ? reason.name : 'UnknownError',
      });
      showAppNotification({
        id: 'cookie-sources-error',
        title: '浏览器检测失败',
        message: '未能检测本机浏览器，请稍后重试。',
        tone: 'error',
      });
    } finally {
      loadingSources = false;
    }
  }

  async function importCookies(): Promise<void> {
    if (!selectedSourceId) return;
    dismissAppNotification('cookie-import-error');
    step = 'importing';
    try {
      const result = await window.hotelButler.cookies.import(selectedSourceId);
      if (result.error) {
        step = 'select';
        showAppNotification({
          id: 'cookie-import-error',
          title: 'Cookie 导入失败',
          // `diagnostic` 只在内测构建里有值（见 shared/diagnostics.ts）。附上它是为了
          // 让测试同学截个图就能定位——友好文案会把不同根因归成同一句话。
          message: result.diagnostic
            ? `${result.error}\n\n详情：${result.diagnostic}`
            : result.error,
          tone: 'error',
          // 带详情时不自动消失：5 秒读不完，更来不及截图。
          ...(result.diagnostic ? { durationMs: 0 } : {}),
        });
        return;
      }
      open = false;
      if (showSuccessNotification) {
        const sourceName = sources.find((item) => item.id === selectedSourceId)?.name ?? '浏览器';
        showAppNotification({
          id: 'cookie-import-success',
          title: 'Cookie 导入完成',
          message: `已从 ${sourceName} 导入 ${result.imported} 个 Cookie${
            result.failed ? `，${result.failed} 个未能导入` : ''
          }`,
          tone: 'default',
        });
      }
      await tick();
      await onComplete();
    } catch (reason) {
      log.warn('Cookie import request failed', {
        errorName: reason instanceof Error ? reason.name : 'UnknownError',
      });
      step = 'select';
      showAppNotification({
        id: 'cookie-import-error',
        title: 'Cookie 导入失败',
        message: 'Cookie 导入失败，请稍后重试。',
        tone: 'error',
      });
    }
  }
</script>

<Button variant={triggerVariant} size={triggerSize} onclick={() => void openDialog()}
  >{triggerLabel}</Button
>

<Dialog.Root bind:open>
  <Dialog.Content
    class="sm:max-w-lg"
    showCloseButton={step !== 'importing'}
    onEscapeKeydown={(event) => step === 'importing' && event.preventDefault()}
    onInteractOutside={(event) => step === 'importing' && event.preventDefault()}
  >
    <Dialog.Header>
      <Dialog.Title class="text-lg">从浏览器导入 Cookie</Dialog.Title>
      <Dialog.Description>选择已登录 OTA 平台的浏览器。</Dialog.Description>
    </Dialog.Header>

    {#if loadingSources}
      <div
        class="flex items-center justify-center gap-2 py-10 text-muted-foreground"
        in:enter={SURFACE_TRANSITION_OPTIONS}
      >
        <Spinner class="size-[18px]" aria-label="正在检测浏览器" />
        <span>正在检测浏览器…</span>
      </div>
    {:else}
      {#if sources.length === 0}
        <p
          class="rounded-md bg-muted px-4 py-3 text-center text-sm text-muted-foreground"
          in:enter={SURFACE_TRANSITION_OPTIONS}
        >
          暂未检测到可导入的浏览器 Cookie 数据。
        </p>
      {/if}
      <fieldset
        class="grid gap-2"
        disabled={step === 'importing'}
        in:enter={SURFACE_TRANSITION_OPTIONS}
      >
        <legend class="sr-only">浏览器</legend>
        {#each BROWSER_COOKIE_OPTIONS as browser (browser.id)}
          {@const available = sourceAvailable(browser.id)}
          <label
            class={[
              'flex items-center gap-3 rounded-md border px-4 py-3 transition-colors duration-150 ease-out motion-reduce:transition-none',
              selectedSourceId === browser.id
                ? 'border-[var(--brand-green-deep)] bg-accent/60'
                : 'border-border',
              available ? 'cursor-pointer hover:bg-muted' : 'cursor-not-allowed opacity-55',
            ]}
          >
            <input
              class="size-4 accent-primary"
              type="radio"
              name="cookie-browser"
              value={browser.id}
              disabled={!available}
              bind:group={selectedSourceId}
            />
            <img
              class="size-6 shrink-0 object-contain"
              src={BROWSER_ICON_URLS[browser.id]}
              alt=""
            />
            <span class="text-sm font-medium">{browser.name}</span>
            {#if !available}
              <span class="ml-auto text-xs text-muted-foreground">未检测到</span>
            {/if}
          </label>
        {/each}
      </fieldset>
    {/if}

    <Dialog.Footer>
      <Button variant="ghost" disabled={step === 'importing'} onclick={() => (open = false)}
        >取消</Button
      >
      <Button
        disabled={!selectedSourceId || loadingSources || step === 'importing'}
        onclick={() => void importCookies()}
      >
        {#if step === 'importing'}
          <Spinner aria-label="正在导入 Cookie" />
          正在导入
        {:else}
          开始导入
        {/if}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
