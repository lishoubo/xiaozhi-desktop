<script lang="ts">
  /**
   * 重新登录的第二步：等主进程核对账号身份，然后收尾。
   *
   * 与 `BindHotelDialog` 同一形状（见
   * `docs/arch/2026-08-08-ota-tab-async-result-pattern.md`），差别只在结果 payload
   * 和收尾动作：这里不选门店，只确认「登录的还是不是原账号」。
   */
  import { onDestroy, onMount } from 'svelte';
  import log from 'electron-log/renderer';
  import type { ReauthOutcomeDto } from '../../../shared/types/ui-waiting-result-types';
  import { otaReauthWaiting } from '../../hotel-management/cross-route-intents';
  import { dismissAppNotification, showAppNotification } from '../../notifications';
  import { createWaitingUiResult } from '../../waiting-ui-result';
  import { bindingFailureMessage } from './binding-failure-message';
  import { browserOtaTabs } from './browser-ota-tabs.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Spinner } from '$lib/components/ui/spinner';
  import * as Dialog from '$lib/components/ui/dialog';

  const NOTIFICATION_ID = 'ota-reauth-error';

  let open = $state(false);
  let submitting = $state(false);
  let outcome = $state<ReauthOutcomeDto | undefined>(undefined);
  let otaAccountId = $state<number | undefined>(undefined);
  let channelName = $state('');
  let cancelWaiting: (() => void) | undefined;

  const waiting = createWaitingUiResult(
    (listener) => window.hotelButler.hotelManagement.onWaitingResult(listener),
    (envelope, waitingCount) => {
      log.warn('Reauth result arrived but nobody claimed it', {
        requestId: envelope.requestId,
        waitingCount,
      });
    },
  );

  onMount(() => {
    const pending = otaReauthWaiting.consume();
    if (!pending) return;
    otaAccountId = pending.otaAccountId;
    channelName = pending.channelName;

    log.info('Reauth waiting registered', { requestId: pending.requestId });
    // 先登记等待再开标签页：结果可能在开 tab 的 await 完成前就到了。
    cancelWaiting = waiting.await('reauth-ota', pending.requestId, (payload) => {
      log.info('Reauth result claimed', { requestId: pending.requestId, ok: payload.ok });
      cancelWaiting = undefined;
      outcome = payload;
      open = true;
      // 原生 WebContentsView 永远盖在 HTML 之上，不让位弹窗就看不见。
      void browserOtaTabs.suspendViewport();
    });

    void browserOtaTabs
      .openExisting(pending.credentialId, {
        kind: 'reauth-ota',
        requestId: pending.requestId,
        expectedChannelAccountId: pending.expectedChannelAccountId,
      })
      .catch((reason: unknown) => {
        cancelWaiting?.();
        cancelWaiting = undefined;
        log.warn('Reauth tab could not be opened', {
          errorName: reason instanceof Error ? reason.name : 'UnknownError',
        });
        showAppNotification({
          id: NOTIFICATION_ID,
          title: '发起重新登录失败',
          message: '打开渠道标签页失败，请重试。',
          tone: 'error',
        });
      });
  });

  onDestroy(() => {
    cancelWaiting?.();
    waiting.dispose();
    log.info('Reauth dialog destroyed', { hadPendingWait: cancelWaiting !== undefined });
  });

  async function confirm(): Promise<void> {
    if (otaAccountId === undefined || outcome?.ok !== true) return;
    dismissAppNotification(NOTIFICATION_ID);
    submitting = true;
    try {
      await window.hotelButler.hotelManagement.confirmReauth({
        otaAccountId,
        credentialId: outcome.credentialId,
      });
      closeDialog();
      showAppNotification({
        id: 'ota-reauth-done',
        title: '已重新登录',
        message: `${channelName}账号的登录状态已更新，门店绑定保持不变。`,
        tone: 'default',
      });
    } catch (reason) {
      log.warn('Reauth failed', {
        errorName: reason instanceof Error ? reason.name : 'UnknownError',
      });
      showAppNotification({
        id: NOTIFICATION_ID,
        title: '重新登录失败',
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
    outcome = undefined;
    void browserOtaTabs.resumeViewport();
  }
</script>

<Dialog.Root
  {open}
  onOpenChange={(next) => {
    // ESC / 点遮罩也要走这里，否则视口不会恢复。
    if (!next) closeDialog();
  }}
>
  <Dialog.Content class="max-w-lg p-7">
    <Dialog.Header>
      <Dialog.Title class="text-lg">
        {outcome?.ok ? '登录成功' : '登录的不是所选账号'}
      </Dialog.Title>
      <Dialog.Description>
        {#if outcome?.ok}
          确认后将用这次的登录状态更新绑定，门店关系保持不变。
        {:else if outcome?.reason === 'account-mismatch'}
          这次登录的账号与你要恢复的账号不是同一个。请回到列表重新选择，或改用「新登录账号」重新绑定。
        {:else}
          没能确认这次登录的账号身份，因此没有更新绑定。请重试，或改用「新登录账号」重新绑定。
        {/if}
      </Dialog.Description>
    </Dialog.Header>

    <Dialog.Footer>
      <Button variant="ghost" disabled={submitting} onclick={closeDialog}>
        {outcome?.ok ? '取消' : '知道了'}
      </Button>
      {#if outcome?.ok}
        <Button disabled={submitting} onclick={() => void confirm()}>
          {#if submitting}
            <Spinner aria-label="正在更新" />
            正在更新
          {:else}
            确认更新
          {/if}
        </Button>
      {/if}
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
