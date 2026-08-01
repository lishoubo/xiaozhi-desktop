<script lang="ts">
  import CheckCircle2 from '@lucide/svelte/icons/circle-check-big';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import type {
    BrowserCookieSource,
    BrowserCookieSourceId,
    CookieImportResult,
  } from '../../../shared/browser';
  import { Button, type ButtonSize, type ButtonVariant } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';

  let {
    triggerLabel,
    triggerVariant = 'default',
    triggerSize = 'default',
    onComplete = () => undefined,
  }: {
    triggerLabel: string;
    triggerVariant?: ButtonVariant;
    triggerSize?: ButtonSize;
    onComplete?: () => void | Promise<void>;
  } = $props();

  let open = $state(false);
  let sources = $state<BrowserCookieSource[]>([]);
  let selectedSourceId = $state<BrowserCookieSourceId | null>(null);
  let step = $state<'select' | 'importing' | 'success'>('select');
  let result = $state<CookieImportResult | null>(null);
  let error = $state('');
  let loadingSources = $state(false);

  async function openDialog(): Promise<void> {
    open = true;
    step = 'select';
    result = null;
    error = '';
    loadingSources = true;
    try {
      sources = await window.hotelButler.cookies.listSources();
      selectedSourceId = sources[0]?.id ?? null;
    } catch {
      error = '浏览器检测失败，请稍后重试';
    } finally {
      loadingSources = false;
    }
  }

  async function importCookies(): Promise<void> {
    if (!selectedSourceId) return;
    step = 'importing';
    error = '';
    try {
      result = await window.hotelButler.cookies.import(selectedSourceId);
      if (result.error) {
        error = result.error;
        result = null;
        step = 'select';
        return;
      }
      step = 'success';
    } catch {
      error = 'Cookie 导入失败，请稍后重试';
      step = 'select';
    }
  }

  async function complete(): Promise<void> {
    open = false;
    await onComplete();
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
    {#if step === 'success' && result}
      <div class="flex flex-col items-center py-3 text-center">
        <CheckCircle2 class="text-green-600" size={36} strokeWidth={1.8} />
        <Dialog.Title class="mt-4 text-lg">导入完成</Dialog.Title>
        <Dialog.Description class="mt-2">
          已从 {sources.find((item) => item.id === selectedSourceId)?.name} 导入
          {result.imported} 个 Cookie{result.failed ? `，${result.failed} 个未能导入` : ''}
        </Dialog.Description>
      </div>
      <Dialog.Footer>
        <Button onclick={() => void complete()}>完成</Button>
      </Dialog.Footer>
    {:else}
      <Dialog.Header>
        <Dialog.Title class="text-lg">从浏览器导入 Cookie</Dialog.Title>
        <Dialog.Description>选择已登录 OTA 平台的浏览器。</Dialog.Description>
      </Dialog.Header>

      {#if loadingSources}
        <div class="flex items-center justify-center gap-2 py-10 text-muted-foreground">
          <LoaderCircle class="animate-spin" size={18} />
          <span>正在检测浏览器…</span>
        </div>
      {:else if sources.length === 0}
        <p class="rounded-md bg-muted px-4 py-5 text-center text-sm text-muted-foreground">
          未检测到支持的浏览器 Cookie 数据。
        </p>
      {:else}
        <fieldset class="grid gap-2" disabled={step === 'importing'}>
          <legend class="sr-only">浏览器</legend>
          {#each sources as browser (browser.id)}
            <label
              class={[
                'flex cursor-pointer items-center gap-3 rounded-md border px-4 py-3 transition-colors',
                selectedSourceId === browser.id
                  ? 'border-primary bg-accent/60'
                  : 'border-border hover:bg-muted',
              ]}
            >
              <input
                class="size-4 accent-primary"
                type="radio"
                name="cookie-browser"
                value={browser.id}
                bind:group={selectedSourceId}
              />
              <span class="text-sm font-medium">{browser.name}</span>
            </label>
          {/each}
        </fieldset>
      {/if}

      {#if error}
        <p class="m-0 text-sm text-destructive" role="alert">{error}</p>
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
            <LoaderCircle class="animate-spin" size={16} />
            正在导入
          {:else}
            开始导入
          {/if}
        </Button>
      </Dialog.Footer>
    {/if}
  </Dialog.Content>
</Dialog.Root>
