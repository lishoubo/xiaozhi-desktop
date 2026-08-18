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
    canManage,
    onAction,
    onUnbind,
  }: {
    account: RmsOtaAccountDto;
    /**
     * 是否展示写操作入口（解绑、重新登录/重新选择门店）。
     *
     * 刻意设为必填：将来出现第二个使用方时，编译器会逼它对权限做出选择，
     * 而不是默认放行。
     */
    canManage: boolean;
    onAction: (action: OtaAccountAction, account: RmsOtaAccountDto, channelName: string) => void;
    onUnbind: (account: RmsOtaAccountDto, channelName: string) => void;
  } = $props();

  let open = $state(false);
  const presentation = $derived(getOtaAccountPresentation(account.status, account.otaHotelId));
  const bindDetails = $derived(getOtaAccountBindDetails(account.bindExtra));
  const channel = $derived(OTA_CHANNELS.find((candidate) => candidate.id === account.source));
  const channelName = $derived(channel?.name ?? account.source);
  const actionLabel = $derived(
    presentation.action === 'login'
      ? '去登录'
      : presentation.action === 'backfill-hotel'
        ? '重新选择门店'
        : '',
  );

  function dotClass(tone: OtaAccountTone): string {
    if (tone === 'healthy') return 'bg-[#2d9d50]';
    if (tone === 'warning') return 'bg-[#d59b20]';
    if (tone === 'progress') return 'bg-[#4e78c4]';
    if (tone === 'error') return 'bg-[#d64b42]';
    return 'bg-muted-foreground';
  }

  /**
   * 状态文字也跟着语义色走——只靠一个 1.5px 的圆点区分健康与失败，扫一眼列表时
   * 根本抓不住。取值比圆点深一档，保证浅色背景上的对比度。
   */
  function statusTextClass(tone: OtaAccountTone): string {
    if (tone === 'healthy') return 'text-[#1f7a3d]';
    if (tone === 'warning') return 'text-[#9a6b0f]';
    if (tone === 'progress') return 'text-[#3a5f9e]';
    if (tone === 'error') return 'text-[#b3352d]';
    return 'text-muted-foreground';
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
      <img class="size-3.5 shrink-0 object-contain opacity-70" src={channel.iconUrl} alt="" />
    {:else}
      <span class="text-[9px] font-semibold text-muted-foreground">OTA</span>
    {/if}
    <span class="min-w-0 truncate text-[11px] text-muted-foreground">{channelName}</span>
    <span class={['size-1.5 shrink-0 rounded-full', dotClass(presentation.tone)]}></span>
    <span class={['shrink-0 text-xs font-medium', statusTextClass(presentation.tone)]}>
      {presentation.label}
    </span>
  </button>

  {#if open}
    <div
      class="absolute top-10 left-0 z-30 w-80 rounded-lg border border-border bg-popover p-3.5 text-popover-foreground shadow-lg"
      role="dialog"
      aria-label={`${channelName}账号详情`}
    >
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="m-0 flex items-center gap-1.5 text-sm font-semibold">
            <span class="min-w-0 truncate">{channelName}</span>
            <span class={['size-1.5 shrink-0 rounded-full', dotClass(presentation.tone)]}></span>
            <span class={['shrink-0 text-xs', statusTextClass(presentation.tone)]}>
              {presentation.label}
            </span>
          </p>
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

      <!--
        整条操作栏只装写操作，无权限时连同分隔线一起隐藏——留一条空的 border-t
        会在详情卡底部拖出一道没有内容的横线。
      -->
      {#if canManage}
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
      {/if}
    </div>
  {/if}
</div>
