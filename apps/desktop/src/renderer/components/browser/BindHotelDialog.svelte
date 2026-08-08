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

  const waiting = createWaitingUiResult((listener) =>
    window.hotelButler.hotelManagement.onWaitingResult(listener),
  );

  onMount(() => {
    // 从酒店管理页跳过来时带着这条意图；直接打开浏览器页时没有，什么都不做。
    const pending = hotelBindingWaiting.consume();
    if (!pending) return;
    rmsHotelId = pending.rmsHotelId;
    rmsHotelName = pending.rmsHotelName;
    cancelWaiting = waiting.await('bind-hotel', pending.requestId, (payload) => {
      cancelWaiting = undefined;
      credentialId = payload.credentialId;
      candidates = payload.hotels;
      selectedOtaHotelId = payload.hotels.length === 1 ? payload.hotels[0]?.otaHotelId : undefined;
      open = true;
    });
  });

  onDestroy(() => {
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
      open = false;
      showAppNotification({
        id: 'bind-hotel-done',
        title: '绑定成功',
        message: `已将「${hotel.otaHotelName ?? hotel.otaHotelId}」绑定到「${rmsHotelName}」。`,
        tone: 'default',
      });
    } catch (reason) {
      // 弹窗保持打开，用户可以直接重试。
      log.warn('Hotel binding failed', {
        errorName: reason instanceof Error ? reason.name : 'UnknownError',
      });
      showAppNotification({
        id: NOTIFICATION_ID,
        title: '绑定失败',
        message: '绑定失败，请重试。',
        tone: 'error',
      });
    } finally {
      submitting = false;
    }
  }

  /** 否决：什么都不写，用户可以回酒店页换个账号重新发起。 */
  function rejectCandidates(): void {
    open = false;
    candidates = [];
    selectedOtaHotelId = undefined;
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-lg">
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
      <Button variant="ghost" disabled={submitting} onclick={rejectCandidates}>都不是</Button>
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
