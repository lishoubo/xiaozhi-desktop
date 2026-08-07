<script lang="ts">
  import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import Unlink from '@lucide/svelte/icons/unlink';
  import X from '@lucide/svelte/icons/x';
  import { Button } from '$lib/components/ui/button';
  import { OTA_CHANNELS } from '../../data/ota-channels';
  import {
    getOtaAccountBindDetails,
    getOtaAccountPresentation,
    type OtaAccountAction,
    type OtaAccountTone,
  } from '../../hotel-management/model';
  import type { RmsOtaAccountDto } from '../../../shared/hotel-management';

  let {
    account,
    onAction,
    onUnbind,
  }: {
    account: RmsOtaAccountDto;
    onAction: (action: OtaAccountAction, account: RmsOtaAccountDto, channelName: string) => void;
    onUnbind: (account: RmsOtaAccountDto, channelName: string) => void;
  } = $props();

  let open = $state(false);
  const presentation = $derived(getOtaAccountPresentation(account.status));
  const bindDetails = $derived(getOtaAccountBindDetails(account.bindExtra));
  const channel = $derived(OTA_CHANNELS.find((candidate) => candidate.id === account.source));
  const channelName = $derived(channel?.name ?? account.source);
  const actionLabel = $derived(
    presentation.action === 'login'
      ? '去登录'
      : presentation.action === 'retry'
        ? '重试初始化'
        : presentation.action === 'resolve'
          ? '处理问题'
          : '',
  );

  function dotClass(tone: OtaAccountTone): string {
    if (tone === 'healthy') return 'bg-[#2d9d50]';
    if (tone === 'warning') return 'bg-[#d59b20]';
    if (tone === 'progress') return 'bg-[#4e78c4]';
    if (tone === 'error') return 'bg-[#d64b42]';
    return 'bg-muted-foreground';
  }

  function runAction(): void {
    const action = presentation.action;
    if (action) onAction(action, account, channelName);
  }

  function runUnbind(): void {
    open = false;
    onUnbind(account, channelName);
  }
</script>

<div class="relative shrink-0" data-testid="bound-ota-account">
  <button
    type="button"
    class="flex h-8 max-w-52 items-center gap-2 rounded-md border border-border bg-background px-2.5 text-left text-xs transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    aria-label={`查看${channelName}账号详情`}
    aria-expanded={open}
    onclick={() => (open = !open)}
  >
    {#if channel}
      <img class="size-4 shrink-0 object-contain" src={channel.iconUrl} alt="" />
    {:else}
      <span class="text-[10px] font-semibold">OTA</span>
    {/if}
    <span class="min-w-0 truncate font-medium">{channelName}</span>
    <span class={['size-1.5 shrink-0 rounded-full', dotClass(presentation.tone)]}></span>
    <span class="shrink-0 text-[11px] text-muted-foreground">{presentation.label}</span>
  </button>

  {#if open}
    <div
      class="absolute top-10 left-0 z-30 w-80 rounded-lg border border-border bg-popover p-3.5 text-popover-foreground shadow-lg"
      role="dialog"
      aria-label={`${channelName}账号详情`}
    >
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="m-0 text-sm font-semibold">{channelName}</p>
          <p class="mt-0.5 mb-0 truncate text-[11px] text-muted-foreground">
            {presentation.description}
          </p>
        </div>
        <button
          type="button"
          class="grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-accent"
          aria-label={`关闭${channelName}账号详情`}
          onclick={() => (open = false)}
        >
          <X size={14} />
        </button>
      </div>

      <dl class="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 border-t border-border pt-3">
        <div class="min-w-0">
          <dt class="text-[10px] text-muted-foreground">OTA 酒店 ID</dt>
          <dd class="mt-0.5 mb-0 truncate text-xs font-medium">{account.otaHotelId ?? '待同步'}</dd>
        </div>
        <div class="min-w-0">
          <dt class="text-[10px] text-muted-foreground">OTA 酒店名称</dt>
          <dd class="mt-0.5 mb-0 truncate text-xs font-medium">
            {account.otaHotelName ?? '待同步'}
          </dd>
        </div>
        {#each bindDetails as field}
          <div class="min-w-0">
            <dt class="text-[10px] text-muted-foreground">{field.label}</dt>
            <dd class="mt-0.5 mb-0 truncate text-xs font-medium">{field.value}</dd>
          </div>
        {/each}
      </dl>

      <div class="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
        <Button
          size="xs"
          variant="outline"
          aria-label={`解绑${channelName}账号`}
          onclick={runUnbind}
        >
          <Unlink />
          解绑
        </Button>
        {#if presentation.action}
          <Button
            size="xs"
            variant={presentation.action === 'login' ? 'default' : 'outline'}
            aria-label={presentation.action === 'login'
              ? `重新登录${channelName}账号`
              : `${actionLabel}${channelName}账号`}
            onclick={runAction}
          >
            {#if presentation.action === 'login'}
              <ArrowUpRight />
            {:else}
              <RotateCcw />
            {/if}
            {actionLabel}
          </Button>
        {/if}
      </div>
    </div>
  {/if}
</div>
