<script lang="ts">
  import Building2 from '@lucide/svelte/icons/building-2';
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Plus from '@lucide/svelte/icons/plus';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import log from 'electron-log/renderer';
  import { onMount } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import { Spinner } from '$lib/components/ui/spinner';
  import * as Dialog from '$lib/components/ui/dialog';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import AddOtaBindingDialog from '../components/hotel/AddOtaBindingDialog.svelte';
  import BoundOtaAccountCard from '../components/hotel/BoundOtaAccountCard.svelte';
  import ReauthOtaAccountDialog from '../components/hotel/ReauthOtaAccountDialog.svelte';
  import {
    groupOtaAccountsByHotelId,
    paginate,
    type OtaAccountAction,
  } from '../hotel-management/model';
  import { needsAttention } from '../hotel-management/account-status';
  import type { RmsHotelDto, RmsOtaAccountDto } from '../../shared/hotel-management';
  import { enter, PAGE_ENTER_OPTIONS } from '../motion';
  import { dismissAppNotification, showAppNotification } from '../notifications';

  let loading = $state(true);
  let loadError = $state(false);
  let hotels = $state<readonly RmsHotelDto[]>([]);
  let otaAccounts = $state<readonly RmsOtaAccountDto[]>([]);
  const accountsByHotelId = $derived(groupOtaAccountsByHotelId(otaAccounts));
  const totalAccounts = $derived(otaAccounts.length);
  const attentionAccounts = $derived(
    otaAccounts.filter((account) => needsAttention(account.status)).length,
  );

  const PAGE_SIZE = 10;
  let currentPage = $state(1);
  const pagination = $derived(paginate(hotels, currentPage, PAGE_SIZE));
  const safePage = $derived(pagination.safePage);
  const totalPages = $derived(pagination.totalPages);
  const pagedHotels = $derived(pagination.pageItems);

  function goToPage(page: number): void {
    currentPage = Math.min(Math.max(1, page), totalPages);
  }

  let createOpen = $state(false);
  let createName = $state('');
  let creating = $state(false);

  let deleteTarget = $state<RmsHotelDto | null>(null);
  let deleting = $state(false);

  let unbindTarget = $state<{ account: RmsOtaAccountDto; channelName: string } | null>(null);
  let unbinding = $state(false);

  async function loadHotelManagement(): Promise<void> {
    loading = true;
    loadError = false;
    try {
      const snapshot = await window.hotelButler.hotelManagement.load();
      hotels = snapshot.hotels;
      otaAccounts = snapshot.otaAccounts;
      dismissAppNotification('hotel-management-load-error');
    } catch (reason) {
      log.warn('Hotel management data could not be loaded', {
        errorName: reason instanceof Error ? reason.name : 'UnknownError',
      });
      loadError = true;
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void loadHotelManagement();
  });

  function openCreateDialog(): void {
    createName = '';
    createOpen = true;
  }

  async function submitCreateHotel(): Promise<void> {
    if (!createName.trim() || creating) return;
    creating = true;
    try {
      await window.hotelButler.hotelManagement.createHotel({ name: createName.trim() });
      createOpen = false;
      await loadHotelManagement();
      // 新酒店追加在末尾，不跳过去用户就看不见自己刚建的那家。
      currentPage = Math.max(1, Math.ceil(hotels.length / PAGE_SIZE));
    } catch (reason) {
      log.warn('Hotel creation failed', {
        errorName: reason instanceof Error ? reason.name : 'UnknownError',
      });
      showAppNotification({
        id: 'hotel-create-error',
        title: '新增酒店失败',
        message: '未能创建酒店，请检查后重试。',
        tone: 'error',
      });
    } finally {
      creating = false;
    }
  }

  async function confirmDeleteHotel(): Promise<void> {
    const target = deleteTarget;
    if (!target || deleting) return;
    deleting = true;
    try {
      await window.hotelButler.hotelManagement.deleteHotel(target.id);
      deleteTarget = null;
      await loadHotelManagement();
    } catch (reason) {
      log.warn('Hotel deletion failed', {
        errorName: reason instanceof Error ? reason.name : 'UnknownError',
      });
      showAppNotification({
        id: 'hotel-delete-error',
        title: '删除酒店失败',
        message: '远端拒绝了此次删除，请稍后重试。',
        tone: 'error',
      });
    } finally {
      deleting = false;
    }
  }

  async function confirmUnbind(): Promise<void> {
    const target = unbindTarget;
    if (!target || unbinding) return;
    unbinding = true;
    try {
      await window.hotelButler.hotelManagement.unbindOtaAccount(target.account.id);
      unbindTarget = null;
      await loadHotelManagement();
    } catch (reason) {
      log.warn('OTA account unbind failed', {
        errorName: reason instanceof Error ? reason.name : 'UnknownError',
      });
      showAppNotification({
        id: 'hotel-unbind-error',
        title: '解绑失败',
        message: '远端拒绝了此次解绑，请稍后重试。',
        tone: 'error',
      });
    } finally {
      unbinding = false;
    }
  }

  function showAccountAction(
    action: OtaAccountAction,
    account: RmsOtaAccountDto,
    channelName: string,
  ): void {
    // 登录类问题走重新登录弹窗；其余（初始化失败、酒店不匹配）刷 cookie 解决不了，
    // 仍未实现。
    if (action === 'login') {
      const hotel = hotels.find((item) => item.id === account.hotelId);
      reauthTarget = { account, rmsHotelName: hotel?.name ?? '' };
      return;
    }
    const actionName = action === 'retry' ? '重试初始化' : '处理绑定问题';
    showAppNotification({
      id: `ota-${account.id}-${action}`,
      title: `${channelName} · ${actionName}`,
      message: `${actionName}流程暂未实现。`,
      tone: 'default',
    });
  }

  let addBindingTarget = $state<RmsHotelDto | null>(null);
  let reauthTarget = $state<{ account: RmsOtaAccountDto; rmsHotelName: string } | null>(null);
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
      <div class="flex items-center gap-3">
        {#if !loading && !loadError}
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
        {/if}
        <Button size="sm" onclick={openCreateDialog}>
          <Plus />
          新增酒店
        </Button>
      </div>
    </header>

    {#if loading}
      <div class="mt-8 flex items-center justify-center gap-2 py-16 text-muted-foreground">
        <Spinner class="size-[18px]" aria-label="正在加载酒店数据" />
        <span>正在加载酒店数据…</span>
      </div>
    {:else if loadError}
      <div
        class="mt-8 flex flex-col items-center gap-3 rounded-lg border border-border bg-card py-16 text-center"
      >
        <p class="m-0 text-sm text-muted-foreground">未能读取酒店管理数据，请重试。</p>
        <Button size="sm" variant="outline" onclick={() => void loadHotelManagement()}
          >重新加载</Button
        >
      </div>
    {:else}
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

        {#each pagedHotels as hotel}
          {@const accounts = accountsByHotelId.get(hotel.id) ?? []}
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
                <span>{accounts.length} 个账号</span>
              </p>
            </div>

            <div class="flex min-w-0 items-center gap-2 overflow-visible">
              {#if accounts.length > 0}
                {#each accounts.slice(0, 3) as account}
                  <BoundOtaAccountCard
                    {account}
                    onAction={showAccountAction}
                    onUnbind={(target, channelName) =>
                      (unbindTarget = { account: target, channelName })}
                  />
                {/each}
                {#if accounts.length > 3}
                  <span class="shrink-0 text-[11px] text-muted-foreground">
                    +{accounts.length - 3}
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
                title="新增绑定账号"
                aria-label={`新增绑定账号 - ${hotel.name}`}
                onclick={() => (addBindingTarget = hotel)}
              >
                <Plus />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                title="删除酒店"
                aria-label={`删除酒店 - ${hotel.name}`}
                onclick={() => (deleteTarget = hotel)}
              >
                <Trash2 />
              </Button>
            </div>
          </section>
        {/each}
      </div>

      {#if totalPages > 1}
        <nav class="mt-3 flex items-center justify-between gap-3" aria-label="酒店列表翻页">
          <span class="text-[11px] text-muted-foreground">
            第 {(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, hotels.length)} 家，共
            {hotels.length} 家
          </span>
          <div class="flex items-center gap-1">
            <Button
              size="icon-sm"
              variant="ghost"
              disabled={safePage <= 1}
              aria-label="上一页"
              onclick={() => goToPage(safePage - 1)}
            >
              <ChevronLeft />
            </Button>
            <span class="px-1 text-xs tabular-nums" aria-current="page">
              {safePage} / {totalPages}
            </span>
            <Button
              size="icon-sm"
              variant="ghost"
              disabled={safePage >= totalPages}
              aria-label="下一页"
              onclick={() => goToPage(safePage + 1)}
            >
              <ChevronRight />
            </Button>
          </div>
        </nav>
      {/if}
    {/if}
  </div>
</main>

<AddOtaBindingDialog
  hotel={addBindingTarget}
  otaAccounts={addBindingTarget ? (accountsByHotelId.get(addBindingTarget.id) ?? []) : []}
  onClose={() => (addBindingTarget = null)}
/>
<ReauthOtaAccountDialog target={reauthTarget} onClose={() => (reauthTarget = null)} />

<Dialog.Root bind:open={createOpen}>
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title class="text-lg">新增酒店</Dialog.Title>
      <Dialog.Description>创建成功后将自动刷新酒店列表。</Dialog.Description>
    </Dialog.Header>
    <label class="grid gap-1.5 text-sm">
      <span class="font-medium">酒店名称</span>
      <input
        class="rounded-md border border-border bg-background px-3 py-2 text-sm"
        bind:value={createName}
        disabled={creating}
        placeholder="请输入酒店名称"
      />
    </label>
    <Dialog.Footer>
      <Button variant="ghost" disabled={creating} onclick={() => (createOpen = false)}>取消</Button>
      <Button disabled={!createName.trim() || creating} onclick={() => void submitCreateHotel()}>
        {#if creating}
          <Spinner aria-label="正在创建" />
          正在创建
        {:else}
          创建
        {/if}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<AlertDialog.Root
  open={deleteTarget !== null}
  onOpenChange={(next) => !next && (deleteTarget = null)}
>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>删除酒店</AlertDialog.Title>
      <AlertDialog.Description>
        确认删除「{deleteTarget?.name}」？此操作依赖远端结果，删除后无法在此撤销。
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel disabled={deleting}>取消</AlertDialog.Cancel>
      <AlertDialog.Action disabled={deleting} onclick={() => void confirmDeleteHotel()}>
        {#if deleting}
          <Spinner aria-label="正在删除" />
          正在删除
        {:else}
          确认删除
        {/if}
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>

<AlertDialog.Root
  open={unbindTarget !== null}
  onOpenChange={(next) => !next && (unbindTarget = null)}
>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>解绑 OTA 账号</AlertDialog.Title>
      <AlertDialog.Description>
        确认解绑「{unbindTarget?.channelName}」账号？本地登录态和探测记录将被保留。
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel disabled={unbinding}>取消</AlertDialog.Cancel>
      <AlertDialog.Action disabled={unbinding} onclick={() => void confirmUnbind()}>
        {#if unbinding}
          <Spinner aria-label="正在解绑" />
          正在解绑
        {:else}
          确认解绑
        {/if}
      </AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
