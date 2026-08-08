<script lang="ts">
  /**
   * 绑定流程的第二步：确认要绑定的门店。
   *
   * 第一步（选 RMS 酒店 + 选渠道账号）在酒店管理页完成，发起后跳到这里；本组件
   * 只负责等候选、就地弹窗、写入。弹窗留在浏览器工作区而不是跳回酒店页，是因为
   * 用户否决候选后要能立刻换个渠道账号重试——跳回去会把这个循环拆成往返。
   */
  import { onDestroy, onMount } from 'svelte';
  import log from 'electron-log/renderer';
  import type { ProbedHotelDto } from '../../../shared/types/ui-waiting-result-types';
  import { hotelBindingWaiting } from '../../hotel-management/cross-route-intents';
  import { dismissAppNotification, showAppNotification } from '../../notifications';
  import { createWaitingUiResult } from '../../waiting-ui-result';
  import { bindingFailureMessage } from './binding-failure-message';
  import { browserOtaTabs } from './browser-ota-tabs.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Spinner } from '$lib/components/ui/spinner';
  import * as Dialog from '$lib/components/ui/dialog';

  const NOTIFICATION_ID = 'bind-hotel-error';

  let open = $state(false);
  let submitting = $state(false);
  let candidates = $state<readonly ProbedHotelDto[]>([]);
  let selectedOtaHotelId = $state<string | undefined>(undefined);
  let credentialId = $state<string | undefined>(undefined);
  let rmsHotelId = $state<number | undefined>(undefined);
  let rmsHotelName = $state('');
  let cancelWaiting: (() => void) | undefined;

  const waiting = createWaitingUiResult(
    (listener) => window.hotelButler.hotelManagement.onWaitingResult(listener),
    (envelope, waitingCount) => {
      log.warn('Binding candidates arrived but nobody claimed them', {
        requestId: envelope.requestId,
        waitingCount,
      });
    },
  );

  onMount(() => {
    // 从酒店管理页跳过来时带着这条意图；直接打开浏览器页时没有，什么都不做。
    const pending = hotelBindingWaiting.consume();
    if (!pending) return;
    rmsHotelId = pending.rmsHotelId;
    rmsHotelName = pending.rmsHotelName;

    log.info('Binding waiting registered', { requestId: pending.requestId });
    // 先登记等待再开标签页：探测发生在导航之后，但先登记不会错过任何结果。
    cancelWaiting = waiting.await('bind-hotel', pending.requestId, (payload) => {
      log.info('Binding candidates claimed', { requestId: pending.requestId });
      cancelWaiting = undefined;
      credentialId = payload.credentialId;
      candidates = payload.hotels;
      selectedOtaHotelId = payload.hotels.length === 1 ? payload.hotels[0]?.otaHotelId : undefined;
      open = true;
      // 原生 WebContentsView 永远盖在 HTML 之上，不让位弹窗就看不见。
      void browserOtaTabs.suspendViewport();
    });

    // 标签页由这里开——不经过 BrowserWorkspace。store 负责三步收尾（进标签栏、
    // 切到该渠道、按视口布局），主进程代劳不了。
    void browserOtaTabs
      .openExisting(pending.credentialId, { kind: 'bind-hotel', requestId: pending.requestId })
      .catch((reason: unknown) => {
        cancelWaiting?.();
        cancelWaiting = undefined;
        log.warn('Binding tab could not be opened', {
          errorName: reason instanceof Error ? reason.name : 'UnknownError',
        });
        showAppNotification({
          id: NOTIFICATION_ID,
          title: '发起绑定失败',
          message: '打开渠道标签页失败，请重试。',
          tone: 'error',
        });
      });
  });

  onDestroy(() => {
    log.info('Binding dialog destroyed', { hadPendingWait: cancelWaiting !== undefined });
    // 用户离开页面即视为放弃：只清本地等待表，主进程不需要知道。
    cancelWaiting?.();
    waiting.dispose();
  });

  async function confirmBinding(): Promise<void> {
    const hotel = candidates.find((item) => item.otaHotelId === selectedOtaHotelId);
    if (!hotel || rmsHotelId === undefined || !credentialId) return;
    dismissAppNotification(NOTIFICATION_ID);
    submitting = true;
    try {
      await window.hotelButler.hotelManagement.confirmBinding({
        credentialId,
        rmsHotelId,
        hotel,
      });
      closeDialog();
      showAppNotification({
        id: 'bind-hotel-done',
        title: '绑定成功',
        message: `已将「${hotel.otaHotelName ?? hotel.otaHotelId}」绑定到「${rmsHotelName}」。`,
        tone: 'default',
      });
    } catch (reason) {
      // 弹窗保持打开，用户可以换一个候选再试。
      log.warn('Hotel binding failed', {
        errorName: reason instanceof Error ? reason.name : 'UnknownError',
      });
      showAppNotification({
        id: NOTIFICATION_ID,
        title: '绑定失败',
        // 透传远端文案：「已存在活跃绑定」这类业务拒绝重试永远不会成功，
        // 统一说「请重试」会让用户白试。
        message: bindingFailureMessage(reason),
        tone: 'error',
      });
    } finally {
      submitting = false;
    }
  }

  /** 关闭弹窗并把内容区还给网页。 */
  function closeDialog(): void {
    open = false;
    void browserOtaTabs.resumeViewport();
  }
</script>

<!-- ESC / 点遮罩关闭也要把内容区还给网页，所以走 onOpenChange 而不是 bind:open。 -->
<Dialog.Root
  {open}
  onOpenChange={(next) => {
    if (next) return;
    closeDialog();
    candidates = [];
    selectedOtaHotelId = undefined;
  }}
>
  <Dialog.Content
    class="max-h-[min(760px,calc(100vh-48px))] gap-5 overflow-y-auto p-7 sm:max-w-4xl"
  >
    <Dialog.Header>
      <Dialog.Title>确认要绑定的门店</Dialog.Title>
      <Dialog.Description>
        识别到以下门店，请选择一家绑定到「{rmsHotelName}」。
      </Dialog.Description>
    </Dialog.Header>

    <ul class="max-h-72 space-y-1 overflow-y-auto py-2">
      {#each candidates as hotel (hotel.otaHotelId)}
        <li>
          <label class="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 hover:bg-accent">
            <input
              type="radio"
              name="ota-hotel"
              value={hotel.otaHotelId}
              checked={selectedOtaHotelId === hotel.otaHotelId}
              onchange={() => (selectedOtaHotelId = hotel.otaHotelId)}
            />
            <span class="min-w-0 text-sm">
              {hotel.otaHotelName ?? '（未命名）'}
              <span class="ml-2 text-xs text-muted-foreground">{hotel.otaHotelId}</span>
            </span>
          </label>
        </li>
      {/each}
    </ul>

    <Dialog.Footer>
      <Button variant="ghost" disabled={submitting} onclick={closeDialog}>都不是</Button>
      <Button disabled={!selectedOtaHotelId || submitting} onclick={() => void confirmBinding()}>
        {#if submitting}
          <Spinner aria-label="正在绑定" />
          正在绑定
        {:else}
          确认绑定
        {/if}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
