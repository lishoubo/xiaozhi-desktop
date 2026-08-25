<script lang="ts">
  import Building2 from '@lucide/svelte/icons/building-2';
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Plus from '@lucide/svelte/icons/plus';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import log from 'electron-log/renderer';
  import { onMount } from 'svelte';
  import { replace } from 'svelte-spa-router';
  import { Button } from '$lib/components/ui/button';
  import { Spinner } from '$lib/components/ui/spinner';
  import * as AlertDialog from '$lib/components/ui/alert-dialog';
  import AddOtaBindingDialog from '../components/hotel/AddOtaBindingDialog.svelte';
  import BoundOtaAccountCard from '../components/hotel/BoundOtaAccountCard.svelte';
  import ReauthOtaAccountDialog from '../components/hotel/ReauthOtaAccountDialog.svelte';
  import {
    formatLastRefreshedAt,
    groupOtaAccountsByHotelId,
    paginate,
    type OtaAccountAction,
  } from '../hotel-management/model';
  import { needsAttention } from '../hotel-management/account-status';
  import type { RmsHotelDto, RmsOtaAccountDto } from '../../shared/hotel-management';
  import { enter, PAGE_ENTER_OPTIONS } from '../motion';
  import { dismissAppNotification, showAppNotification } from '../notifications';
  import { readAuthSession } from '../auth';
  import { readStaffSession } from '../staff-auth';
  import { capabilitiesOf } from '../permissions';
  import { IS_STAFF_AUTH } from '../../shared/auth-variant';

  /**
   * 界面能力。会话在一次页面生命周期内不会变——变了必然经过登出、整页重建，
   * 所以读一次就够，不需要响应式 store。
   *
   * 两个登录变体各有各的会话存放处，这里按编译期变体取对应的那个；`capabilitiesOf`
   * 对两种身份形状都做默认拒绝。
   */
  const capabilities = capabilitiesOf(IS_STAFF_AUTH ? readStaffSession() : readAuthSession());
  /** 写操作入口的开关（按权限码）。 */
  const canManage = capabilities.manageHotel;

  /**
   * 表头与数据行必须用同一份列定义，否则两者错位。无写权限时第三列（操作）整列
   * 没有内容，留着宽度会在每行右侧空出一段。
   *
   * 56px 是按当前仅剩的一个 `icon-sm`（32px）按钮量的；原先 88px 对应的是「新增
   * 绑定账号 + 删除酒店」两个按钮，删除酒店入口下线后不缩回来会右侧留白。
   */
  const gridColumns = canManage
    ? 'grid-cols-[minmax(180px,0.8fr)_minmax(360px,2fr)_56px]'
    : 'grid-cols-[minmax(180px,0.8fr)_minmax(360px,2fr)]';

  let loading = $state(true);
  let loadError = $state(false);
  let refreshing = $state(false);
  let hotels = $state<readonly RmsHotelDto[]>([]);
  let otaAccounts = $state<readonly RmsOtaAccountDto[]>([]);
  let lastRefreshedAt = $state<Date | null>(null);
  // 时刻本身不会走，但「是不是今天」会：跨过午夜后要补回日期前缀，
  // 否则昨晚的数据只显示 `19:54`，看着像刚拉的。
  let clockTick = $state(new Date());
  const lastRefreshedLabel = $derived(
    lastRefreshedAt === null ? null : formatLastRefreshedAt(lastRefreshedAt, clockTick),
  );
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

  let unbindTarget = $state<{ account: RmsOtaAccountDto; channelName: string } | null>(null);
  let unbinding = $state(false);

  /**
   * `silent` 用于手动刷新：不清空已有数据、不进骨架态，只让按钮转起来。整页闪回
   * loading 会把用户正在看的那一行抽走，手动刷新反而更难用。
   */
  async function loadHotelManagement(options: { silent?: boolean } = {}): Promise<void> {
    const silent = options.silent ?? false;
    if (silent) refreshing = true;
    else loading = true;
    loadError = false;
    try {
      const snapshot = await window.hotelButler.hotelManagement.load();
      hotels = snapshot.hotels;
      otaAccounts = snapshot.otaAccounts;
      lastRefreshedAt = new Date();
      clockTick = lastRefreshedAt;
      dismissAppNotification('hotel-management-load-error');
    } catch (reason) {
      log.warn('Hotel management data could not be loaded', {
        errorName: reason instanceof Error ? reason.name : 'UnknownError',
      });
      // 静默刷新失败时保留旧数据：手上这份过时但可用，清空只会让用户什么都看不到。
      if (silent) {
        showAppNotification({
          id: 'hotel-management-refresh-error',
          title: '刷新失败',
          message: '未能获取最新数据，当前显示的仍是上次结果。',
          tone: 'error',
        });
      } else {
        loadError = true;
      }
    } finally {
      loading = false;
      refreshing = false;
    }
  }

  onMount(() => {
    /**
     * 兜底：菜单入口已按用户类型隐藏，但路由表是编译期静态的，跨路由跳转、历史地址、
     * 手敲地址仍能到这里。
     *
     * 重定向必须**先于** `loadHotelManagement()`：服务端的 `hotel:view` 对酒店用户是
     * 放行的，晚一步就会白发一次请求——拿得到数据，纯属浪费加日志噪音。
     *
     * 这是界面收口，不是访问控制。真正的防线在服务端。
     */
    if (!capabilities.showHotelManagement) {
      replace('/');
      return;
    }

    void loadHotelManagement();

    const timer = setInterval(() => {
      clockTick = new Date();
    }, 60_000);
    return () => clearInterval(timer);
  });

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

  /**
   * 自助入口，两种：`login` 是登录态坏了；`backfill-hotel` 是绑定没有关联门店
   * ——后者刷 cookie 解决不了，要重新选一次门店补写。
   *
   * 初始化失败、酒店不匹配这类状态两者都解决不了，`getOtaAccountPresentation`
   * 已经把它们归到「联系管理员」且不产出 action，所以这里不必再分支。
   */
  function showAccountAction(action: OtaAccountAction, account: RmsOtaAccountDto): void {
    const hotel = hotels.find((item) => item.id === account.hotelId);
    if (action === 'backfill-hotel') {
      backfillTarget = { account, rmsHotelName: hotel?.name ?? '' };
      return;
    }
    reauthTarget = { account, rmsHotelName: hotel?.name ?? '' };
  }

  let addBindingTarget = $state<RmsHotelDto | null>(null);
  let reauthTarget = $state<{ account: RmsOtaAccountDto; rmsHotelName: string } | null>(null);
  /** 「未绑定成功」的修复流程：同一个弹窗，只是选完账号后走补写门店。 */
  let backfillTarget = $state<{ account: RmsOtaAccountDto; rmsHotelName: string } | null>(null);
</script>

<main
  class="h-full overflow-auto bg-[#f8fafb] px-6 py-6 sm:px-8"
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
        <div class="flex items-center gap-2.5">
          <h1 class="m-0 text-xl font-semibold tracking-[-0.02em]">酒店管理</h1>
          {#if lastRefreshedLabel !== null}
            <span class="text-[11px] text-muted-foreground" aria-live="polite">
              更新于 {lastRefreshedLabel}
            </span>
          {/if}
          <Button
            size="sm"
            variant="ghost"
            class="h-7 gap-1.5 px-2 text-[11px] text-muted-foreground"
            disabled={loading || refreshing}
            aria-label="刷新酒店数据"
            onclick={() => void loadHotelManagement({ silent: true })}
          >
            <RefreshCw size={13} class={refreshing ? 'animate-spin' : undefined} />
            刷新
          </Button>
        </div>
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
              <span class="rounded-full bg-destructive/10 px-2 py-0.5 font-medium text-destructive">
                {attentionAccounts} 个待处理
              </span>
            {/if}
          </div>
        {/if}
        <!--
          「新增酒店」「删除酒店」两个入口已下线：它们打到服务端的
          `AppHotelCrudController`，该 Bean 受 `rms.app.hotel-crud.enabled` 控制，
          生产环境不注册，调用返回 404 而非 403。

          preload → IPC → service → gateway 五层调用链**有意保留**（连同它们的测试）
          ——服务端能力是「未开放」而不是「已废弃」，开关一开即可恢复界面入口。
        -->
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
        class="mt-5 overflow-visible rounded-[12px] border border-border bg-card shadow-[var(--shadow-card)]"
      >
        <div
          class={[
            'grid items-center gap-4 border-b border-border bg-muted/40 px-4 py-2 text-[11px] font-medium text-muted-foreground',
            gridColumns,
          ]}
          aria-hidden="true"
        >
          <span>酒店</span>
          <span>绑定的 OTA 账号</span>
          {#if canManage}
            <span class="text-right">操作</span>
          {/if}
        </div>

        <!--
          空态刻意保持朴素：不写「联系管理员开通」一类引导——酒店用户看到空列表是
          正常状态，不是需要补救的故障。
        -->
        {#if hotels.length === 0}
          <p class="m-0 px-4 py-10 text-center text-sm text-muted-foreground">暂无酒店</p>
        {/if}

        {#each pagedHotels as hotel}
          {@const accounts = accountsByHotelId.get(hotel.id) ?? []}
          <section
            class={[
              'grid min-h-16 items-center gap-4 border-b border-border px-4 py-2 last:border-b-0',
              gridColumns,
            ]}
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
                    {canManage}
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

            {#if canManage}
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
              </div>
            {/if}
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
<ReauthOtaAccountDialog
  target={backfillTarget}
  mode="backfill-hotel"
  onClose={() => (backfillTarget = null)}
/>

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
