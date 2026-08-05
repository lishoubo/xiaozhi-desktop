<script lang="ts">
  import Building2 from '@lucide/svelte/icons/building-2';
  import Plus from '@lucide/svelte/icons/plus';
  import Settings2 from '@lucide/svelte/icons/settings-2';
  import { Button } from '$lib/components/ui/button';
  import BoundOtaAccountCard from '../components/hotel/BoundOtaAccountCard.svelte';
  import { MOCK_MANAGED_HOTELS } from '../hotel-management/mock-hotels';
  import type { BoundOtaAccount, OtaAccountAction } from '../hotel-management/model';
  import { enter, PAGE_ENTER_OPTIONS } from '../motion';
  import { showAppNotification } from '../notifications';

  const hotels = MOCK_MANAGED_HOTELS;
  const totalAccounts = hotels.reduce((sum, hotel) => sum + hotel.otaAccounts.length, 0);
  const attentionAccounts = hotels.reduce(
    (sum, hotel) =>
      sum +
      hotel.otaAccounts.filter((account) =>
        ['LOGIN_FAILED', 'LOGIN_EXPIRED', 'INIT_FAILED', 'HOTEL_NAME_MISMATCH'].includes(
          account.status,
        ),
      ).length,
    0,
  );

  function showHotelAction(action: 'add' | 'manage', hotelName: string): void {
    showAppNotification({
      id: `hotel-${action}`,
      title: '设计预览',
      message: `${hotelName}的${action === 'add' ? '新增绑定账号' : '绑定账号管理'}入口暂未连接服务端。`,
      tone: 'default',
    });
  }

  function showAccountAction(
    action: OtaAccountAction,
    account: BoundOtaAccount,
    channelName: string,
  ): void {
    const actionName =
      action === 'login' ? '重新登录' : action === 'retry' ? '重试初始化' : '处理绑定问题';
    showAppNotification({
      id: `ota-${account.id}-${action}`,
      title: `${channelName} · ${actionName}`,
      message: `${actionName}流程暂未连接服务端，当前仅展示页面设计。`,
      tone: 'default',
    });
  }
</script>

<main
  class="h-full overflow-auto bg-secondary px-5 py-5 sm:px-7"
  data-motion="page"
  in:enter={PAGE_ENTER_OPTIONS}
>
  <div class="mx-auto max-w-[1440px]">
    <header class="flex items-center justify-between gap-5">
      <div>
        <div class="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-primary">
          <Building2 size={13} />
          资产与渠道
        </div>
        <h1 class="m-0 text-xl font-semibold tracking-[-0.02em]">酒店管理</h1>
      </div>
      <div
        class="flex items-center gap-2 text-[11px] text-muted-foreground"
        aria-label="酒店绑定概览"
      >
        <span>{hotels.length} 家酒店</span>
        <span aria-hidden="true">·</span>
        <span>{totalAccounts} 个账号</span>
        {#if attentionAccounts > 0}
          <span class="rounded-full bg-[#fde9e7] px-2 py-0.5 font-medium text-[#a8342d]">
            {attentionAccounts} 个待处理
          </span>
        {/if}
      </div>
    </header>

    <div
      class="mt-4 overflow-visible rounded-lg border border-border bg-card shadow-[0_1px_3px_rgba(20,20,20,0.035)]"
    >
      <div
        class="grid grid-cols-[minmax(180px,0.8fr)_minmax(360px,2fr)_88px] items-center gap-4 border-b border-border bg-muted/40 px-4 py-2 text-[11px] font-medium text-muted-foreground"
        aria-hidden="true"
      >
        <span>酒店</span>
        <span>绑定的 OTA 账号</span>
        <span class="text-right">操作</span>
      </div>

      {#each hotels as hotel}
        <section
          class="grid min-h-16 grid-cols-[minmax(180px,0.8fr)_minmax(360px,2fr)_88px] items-center gap-4 border-b border-border px-4 py-2 last:border-b-0"
          data-testid="managed-hotel"
          data-layout="single-row"
          aria-labelledby={`hotel-${hotel.id}`}
        >
          <div class="min-w-0">
            <h2 id={`hotel-${hotel.id}`} class="m-0 truncate text-sm font-semibold">
              {hotel.name}
            </h2>
            <p class="mt-1 mb-0 truncate text-[11px] text-muted-foreground">
              <span>{hotel.city}</span>
              <span aria-hidden="true"> · </span>
              <span>{hotel.otaAccounts.length} 个账号</span>
            </p>
          </div>

          <div class="flex min-w-0 items-center gap-2 overflow-visible">
            {#if hotel.otaAccounts.length > 0}
              {#each hotel.otaAccounts.slice(0, 3) as account}
                <BoundOtaAccountCard {account} onAction={showAccountAction} />
              {/each}
              {#if hotel.otaAccounts.length > 3}
                <span class="shrink-0 text-[11px] text-muted-foreground">
                  +{hotel.otaAccounts.length - 3}
                </span>
              {/if}
            {:else}
              <span class="text-xs text-muted-foreground">暂未绑定</span>
            {/if}
          </div>

          <div class="flex justify-end gap-1">
            <Button
              size="icon-sm"
              variant="ghost"
              title="绑定账号管理"
              aria-label={`绑定账号管理 - ${hotel.name}`}
              onclick={() => showHotelAction('manage', hotel.name)}
            >
              <Settings2 />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              title="新增绑定账号"
              aria-label={`新增绑定账号 - ${hotel.name}`}
              onclick={() => showHotelAction('add', hotel.name)}
            >
              <Plus />
            </Button>
          </div>
        </section>
      {/each}
    </div>
  </div>
</main>
