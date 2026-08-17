<script lang="ts">
  /**
   * 重新登录的第二步：等主进程核对完，然后收尾。
   *
   * 与 `BindHotelDialog` 同一形状（见
   * `docs/arch/2026-08-08-ota-tab-async-result-pattern.md`），差别只在结果 payload
   * 和收尾动作：这里不选门店，只确认核对通过没有。
   *
   * 承接**两种**发起方式，它们产出相同（只换凭证、门店关系不动），只是核对锚点不同：
   *
   * ```
   * otaReauthWaiting        锚点=账号  → openExisting + reauth-ota
   * otaReauthByHotelWaiting 锚点=门店  → 见 openForHotelAnchoredReauth（抖音走
   *                                      openExistingForBinding，其余复用）
   * ```
   *
   * 两者共用 waiting kind `'reauth-ota'` —— intent 说「为什么打开」，waiting 说
   * 「在等什么结果」，这里是「两种打开方式、同一种结果」。
   */
  import { onDestroy, onMount } from 'svelte';
  import log from 'electron-log/renderer';
  import type { ReauthOutcomeDto } from '../../../shared/types/ui-waiting-result-types';
  import {
    otaReauthByHotelWaiting,
    otaReauthWaiting,
  } from '../../hotel-management/cross-route-intents';
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
  /** 这次是按门店核对的（RMS 老数据），只影响文案与是否补写绑定上下文。 */
  let anchoredByHotel = $state(false);
  let rmsHotelName = $state('');
  let cancelWaiting: (() => void) | undefined;

  const waiting = createWaitingUiResult(
    (listener) => window.hotelButler.hotelManagement.onWaitingResult(listener),
    // 同 `BindHotelDialog`：结果是广播的，收到别人那份很正常，靠 `kind` 区分。
    (envelope, waitingCount) => {
      log.warn('Waiting result arrived but nobody claimed it', {
        requestId: envelope.requestId,
        kind: envelope.kind,
        waitingCount,
      });
    },
  );

  onMount(() => {
    const byAccount = otaReauthWaiting.consume();
    const byHotel = byAccount ? null : otaReauthByHotelWaiting.consume();
    const pending = byAccount ?? byHotel;
    if (!pending) return;
    otaAccountId = pending.otaAccountId;
    channelName = pending.channelName;
    anchoredByHotel = byHotel !== null;
    rmsHotelName = byHotel?.rmsHotelName ?? '';

    log.info('Reauth waiting registered', {
      requestId: pending.requestId,
      anchor: byHotel === null ? 'channel-account' : 'ota-hotel',
    });
    // 先登记等待再开标签页：结果可能在开 tab 的 await 完成前就到了。
    cancelWaiting = waiting.await('reauth-ota', pending.requestId, (payload) => {
      log.info('Reauth result claimed', { requestId: pending.requestId, ok: payload.ok });
      cancelWaiting = undefined;
      outcome = payload;
      open = true;
      // 原生 WebContentsView 永远盖在 HTML 之上，不让位弹窗就看不见。
      void browserOtaTabs.suspendViewport();
    });

    // 按账号核对只有「恢复这个凭证」一个起点；按门店核对多一个「新登录账号」，
    // 因为老记录很可能本机压根没有对应凭证。
    const opening = byHotel
      ? openForHotelAnchoredReauth(byHotel)
      : browserOtaTabs.openExisting(byAccount!.credentialId, {
          kind: 'reauth-ota',
          requestId: byAccount!.requestId,
          expectedChannelAccountId: byAccount!.expectedChannelAccountId,
        });

    void opening.catch((reason: unknown) => {
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

  /**
   * 按门店核对要先看清「这个账号能管哪些门店」，所以开 tab 的方式与常规重登不同。
   *
   * ## 抖音必须换一份 partition，其余两家不用 —— 这个差异是有意的
   *
   * 抖音复用 partition 时，**服务端**记着这个会话上次用的 `life_account_id`，
   * 会直接跳过选公司页落到上次那家门店（CDP 实证见 `OtaTabService`
   * `openExistingForBinding` 的注释，清本地存储无效）。于是探测只看得到落地的那
   * 一家 —— 账号明明管着目标门店，也会被判成 `hotel-mismatch`。
   * 2026-08-15 真机复现：`discoveredCount: 1`，广昊假日酒店核对失败。
   *
   * `openExistingForBinding` 新建 partition 并注入 cookie，抖音因此认不出「上次
   * 那家」，会重新问一次 —— 这正是绑定流程需要它的原因，与这里的诉求一致。
   *
   * 携程、美团**没有选公司页**：落地后携程从 `credentialExtra` 直接读、美团的
   * `poiInfos` 本就返回账号下全量门店，复用 partition 拿到的就是完整列表。
   * 给它们也换新 partition 只会每次多留一份目录（要靠账本回收），换不来任何东西。
   *
   * 所以这里**不统一** —— 统一会把「抖音有选公司页」这个渠道事实伪装成通用规则，
   * 反而更难懂。按渠道分支，把差异连同原因写在分支旁边。
   */
  function openForHotelAnchoredReauth(
    pending: NonNullable<ReturnType<typeof otaReauthByHotelWaiting.consume>>,
  ): Promise<unknown> {
    const intent = {
      kind: 'reauth-by-hotel',
      requestId: pending.requestId,
      expectedOtaHotelId: pending.expectedOtaHotelId,
      otaAccountId: pending.otaAccountId,
    } as const;
    if (pending.credentialId) {
      return pending.channelId === 'douyin'
        ? browserOtaTabs.openExistingForBinding(pending.credentialId, intent)
        : browserOtaTabs.openExisting(pending.credentialId, intent);
    }
    if (pending.newLoginChannel) {
      return browserOtaTabs.openForNewLogin(
        pending.newLoginChannel.channelId,
        pending.newLoginChannel.url,
        intent,
      );
    }
    return Promise.reject(new Error('重新登录意图缺少账号来源'));
  }

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
      // 不传 bindExtra：要补写的账号级身份由主进程从凭证取；门店级参数一律不在
      // 重新登录这条路上写（同账号下每家门店取值可能不同，这里没确认门店）。
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
        {#if outcome?.ok}
          登录成功
        {:else if outcome?.reason === 'hotel-mismatch'}
          没有核对到这家门店
        {:else}
          登录的不是所选账号
        {/if}
      </Dialog.Title>
      <Dialog.Description>
        {#if outcome?.ok}
          确认后将用这次的登录状态更新绑定，门店绑定关系保持不变。
        {:else if outcome?.reason === 'hotel-mismatch'}
          <!--
            不能说成「这个账号没有权限」：抖音一个账号管多家门店，页面停在哪一家
            决定了我们能看到哪一家。更常见的原因是**选错了门店**，而不是账号不对。
          -->
          没有在这次登录中核对到「{rmsHotelName}」，因此没有更新绑定。
          {#if outcome.actualHotels && outcome.actualHotels.length > 0}
            这次看到的是{outcome.actualHotels
              .map((hotel) => `「${hotel.otaHotelName ?? hotel.otaHotelId}」`)
              .join('、')}。
          {/if}
          若该账号确实管理这家门店，请重试并在渠道页面中切换到它；否则请换一个账号。
        {:else if outcome?.reason === 'account-mismatch'}
          这次登录的账号与你要恢复的账号不是同一个。请回到列表重新选择，或改用「新登录账号」重新绑定。
        {:else if anchoredByHotel}
          没能确认这次登录的账号能管理哪些门店，因此没有更新绑定。请重试。
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
