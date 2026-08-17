<script lang="ts">
  /**
   * 「重新登录」的第一步：为一条失效的远端绑定挑一个账号。
   *
   * 两条出路语义不同：
   * - 选**已有账号** → 只刷新登录态，门店关系不变（B 路）
   * - 点**新登录账号** → 换了账号，可操作的门店可能不同，走完整绑定（A 路）
   *
   * 能匹配回本地凭证的账号会标注「上次绑定过」，让用户一眼认出要恢复的是哪个。
   * 匹配不上不阻断——凭证可能已清理，也可能绑定发生在别的设备上。
   */
  import Plus from '@lucide/svelte/icons/plus';
  import log from 'electron-log/renderer';
  import { push } from 'svelte-spa-router';
  import type { OtaCredentialDto } from '../../../shared/browser';
  import type { RmsOtaAccountDto } from '../../../shared/hotel-management';
  import { OTA_CHANNELS } from '../../data/ota-channels';
  import {
    hotelBindingWaiting,
    otaReauthByHotelWaiting,
    otaReauthWaiting,
  } from '../../hotel-management/cross-route-intents';
  import { channelAccountIdFromBindExtra } from '../../../shared/bind-extra-fields';
  import { createPagination } from '../../hotel-management/paginate.svelte';
  import CredentialPager from './CredentialPager.svelte';
  import { credentialPresentation } from '../../hotel-management/credential-presentation';
  import { dismissAppNotification, showAppNotification } from '../../notifications';
  import { toPlainJson } from '../../ipc-payload';
  import { Button } from '$lib/components/ui/button';
  import { Spinner } from '$lib/components/ui/spinner';
  import * as Dialog from '$lib/components/ui/dialog';

  type Target = Readonly<{ account: RmsOtaAccountDto; rmsHotelName: string }>;
  /**
   * `reauth` 是常规重新登录；`backfill-hotel` 是修复没有门店的绑定 —— 后者选完账号
   * 要走绑定流程的前半段（探测 + 让用户选门店），收尾调 `confirmBackfillHotel`。
   * 两者的第一步完全相同（为这条绑定挑一个账号），故共用这个弹窗。
   */
  type Props = {
    target: Target | null;
    mode?: 'reauth' | 'backfill-hotel';
    onClose: () => void;
  };
  const { target, mode = 'reauth', onClose }: Props = $props();

  const NOTIFICATION_ID = 'ota-reauth-error';

  let loading = $state(false);
  let submitting = $state(false);
  let credentials = $state<OtaCredentialDto[]>([]);
  let lastBoundCredentialId = $state<string | null>(null);
  let selectedCredentialId = $state<string | undefined>(undefined);

  const channel = $derived(OTA_CHANNELS.find((item) => item.id === target?.account.source));
  const channelName = $derived(channel?.name ?? target?.account.source ?? '');

  /**
   * 远端这条绑定记着的渠道账号标识 —— 整个弹窗的分流依据。
   *
   * 非 null：桌面端绑的，知道该恢复哪个账号，按账号核对。
   * null：RMS 后台绑的老记录，认不出账号，按门店核对。
   */
  const boundChannelAccountId = $derived(
    target === null ? null : channelAccountIdFromBindExtra(target.account.bindExtra),
  );

  /**
   * 能不能按门店核对 —— 两个锚点缺一不可地**至少要有一个**。
   *
   * ```
   * 有 channelAccountId              → 按账号核对（场景 1）
   * 无 channelAccountId + 有门店      → 按门店核对（场景 2）
   * 无 channelAccountId + 无门店      → 两个锚点都没有 → 只能走完整绑定重新确认门店
   * ```
   *
   * 最后一种是改动前就有的行为，不该拦：拦了会让用户撞上「请改用新登录账号」，
   * 而他点的就是新登录账号 —— 死路一条。
   */
  const canAnchorByHotel = $derived(
    boundChannelAccountId === null && (target?.account.otaHotelId ?? null) !== null,
  );

  /**
   * 场景 1 里那个「已经确定是它」的凭证。远端有账号标识、且本机匹配得到时才成立
   * ——匹配不到说明凭证已清理或换了设备，只能走「新登录账号」。
   */
  const identifiedCredential = $derived(
    boundChannelAccountId === null
      ? undefined
      : credentials.find((item) => item.channelAccountId === boundChannelAccountId),
  );

  const pagination = createPagination(() => credentials);

  async function loadCredentials(account: RmsOtaAccountDto): Promise<void> {
    loading = true;
    selectedCredentialId = undefined;
    lastBoundCredentialId = null;
    pagination.reset();
    try {
      const [list, matched] = await Promise.all([
        window.hotelButler.otaCredential.listByChannel(account.source).catch(() => []),
        window.hotelButler.hotelManagement
          .findCredentialForAccount({
            source: account.source,
            otaHotelId: account.otaHotelId,
            // `bindExtra` 来自远端响应、又进了 Svelte 的响应式状态，是个 Proxy。
            // contextBridge 用结构化克隆传参，克隆 Proxy 会**同步**抛
            // `An object could not be cloned`——挂在 Promise 上的 .catch() 拦不住，
            // 会把同批次的 listByChannel 一起带崩。必须在进 IPC 前还原成纯对象。
            bindExtra: toPlainJson(account.bindExtra),
          })
          // 标注只是展示增强，查不到就不标注，不影响用户继续操作。
          .catch(() => null),
      ]);
      // 匹配到的那个排到最前：分页后它可能落在第二页，而它恰恰是用户最该看到的。
      credentials =
        matched === null
          ? [...list]
          : [...list].sort((a, b) => Number(b.id === matched) - Number(a.id === matched));
      lastBoundCredentialId = matched;
      // 上次绑定过的那个默认选中——绝大多数情况用户要恢复的就是它。
      if (matched && list.some((item) => item.id === matched)) selectedCredentialId = matched;
      // 场景 1 不渲染单选列表（该恢复哪个已经确定），选中态得在这里定下来，
      // 否则「重新登录」按钮永远是禁用的。
      const identified = channelAccountIdFromBindExtra(account.bindExtra);
      if (identified !== null) {
        selectedCredentialId = list.find((item) => item.channelAccountId === identified)?.id;
      }
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    if (target) void loadCredentials(target.account);
  });

  /**
   * B 路：恢复登录态，门店关系不动。
   *
   * 按这条绑定**远端有没有渠道账号标识**分两种核对方式（见
   * `openspec/changes/reauth-intent-and-legacy-binding/design.md`）：
   *
   * ```
   * 桌面端绑的   有标识 → 锚点=账号：登录出来的必须还是它
   * RMS 后台绑的 无标识 → 锚点=门店：登录出来的账号得管得了这家店
   * ```
   *
   * 两种都只换凭证，区别只在拿什么核对。**都不走绑定流程** —— 那会改门店关系。
   */
  async function startReauth(): Promise<void> {
    const credential = credentials.find((item) => item.id === selectedCredentialId);
    if (!target || !credential) return;
    if (mode === 'backfill-hotel') {
      await startBackfillHotel(credential.id);
      return;
    }
    if (canAnchorByHotel) {
      await startReauthByHotel(credential.id);
      return;
    }
    // 远端记着账号标识，就必须能核对：选中的凭证自己没有标识时无从比对，主进程
    // 那边一定会拒绝——不如在这里说清楚。
    if (!credential.channelAccountId) {
      showAppNotification({
        id: NOTIFICATION_ID,
        title: '无法重新登录',
        message: '该账号缺少渠道身份信息，请改用「新登录账号」重新绑定。',
        tone: 'error',
      });
      return;
    }
    dismissAppNotification(NOTIFICATION_ID);
    submitting = true;
    try {
      const { requestId } = await window.hotelButler.hotelManagement.startReauth();
      otaReauthWaiting.set({
        requestId,
        credentialId: credential.id,
        expectedChannelAccountId: credential.channelAccountId,
        otaAccountId: target.account.id,
        channelName,
      });
      onClose();
      await push('/');
    } catch (reason) {
      log.warn('Reauth could not be started', {
        errorName: reason instanceof Error ? reason.name : 'UnknownError',
      });
      showAppNotification({
        id: NOTIFICATION_ID,
        title: '发起重新登录失败',
        message: '请重试。',
        tone: 'error',
      });
    } finally {
      submitting = false;
    }
  }

  /**
   * 修复没有门店的绑定：走绑定流程的前半段（探测 + 用户选门店），收尾补写门店。
   *
   * 用的是绑定意图 `hotelBindingWaiting`，只多带一个 `backfillOtaAccountId` ——
   * 前半段与新增绑定一模一样，只有最后提交时改调 `confirmBackfillHotel`。
   *
   * `credentialId` 为空表示「新登录一个账号」，与新增绑定的两个起点一致。
   */
  async function startBackfillHotel(credentialId?: string): Promise<void> {
    if (!target || !channel) return;
    dismissAppNotification(NOTIFICATION_ID);
    submitting = true;
    try {
      const { requestId } = await window.hotelButler.hotelManagement.startBinding();
      hotelBindingWaiting.set({
        requestId,
        credentialId,
        newLoginChannel:
          credentialId === undefined ? { channelId: channel.id, url: channel.url } : undefined,
        rmsHotelId: target.account.hotelId,
        rmsHotelName: target.rmsHotelName,
        backfillOtaAccountId: target.account.id,
      });
      onClose();
      await push('/');
    } catch (reason) {
      log.warn('Backfill hotel could not be started', {
        errorName: reason instanceof Error ? reason.name : 'UnknownError',
      });
      showAppNotification({
        id: NOTIFICATION_ID,
        title: '发起修复失败',
        message: '请重试。',
        tone: 'error',
      });
    } finally {
      submitting = false;
    }
  }

  /**
   * B 路的老数据分支：远端没有账号标识，用门店当锚点核对。
   *
   * `credentialId` 为空表示「新登录一个账号再核对」——两个起点核对逻辑完全相同，
   * 汇合在主进程的 `reauth-by-hotel` intent 上。
   */
  async function startReauthByHotel(credentialId?: string): Promise<void> {
    if (!target || !channel) return;
    const expectedOtaHotelId = target.account.otaHotelId;
    // 走到这里门店一定在：没有门店的绑定在卡片上就被判成「未绑定成功」，给的是
    // 「重新绑定」入口，根本进不了这个弹窗（`getOtaAccountPresentation`）。
    // 留这一道只为收窄类型 + 万一分流漏了能在日志里查到，不给用户弹提示——
    // 提示「请改用新登录账号」会把从新登录账号进来的用户堵死在原地。
    if (expectedOtaHotelId === null || !canAnchorByHotel) {
      log.warn('Reauth by hotel skipped: binding has no hotel', {
        otaAccountId: target.account.id,
      });
      return;
    }
    dismissAppNotification(NOTIFICATION_ID);
    submitting = true;
    try {
      const { requestId } = await window.hotelButler.hotelManagement.startReauth();
      otaReauthByHotelWaiting.set({
        requestId,
        credentialId,
        newLoginChannel:
          credentialId === undefined ? { channelId: channel.id, url: channel.url } : undefined,
        otaAccountId: target.account.id,
        expectedOtaHotelId,
        channelId: channel.id,
        channelName,
        rmsHotelName: target.rmsHotelName,
      });
      onClose();
      await push('/');
    } catch (reason) {
      log.warn('Reauth by hotel could not be started', {
        errorName: reason instanceof Error ? reason.name : 'UnknownError',
      });
      showAppNotification({
        id: NOTIFICATION_ID,
        title: '发起重新登录失败',
        message: '请重试。',
        tone: 'error',
      });
    } finally {
      submitting = false;
    }
  }

  /**
   * A 路：换账号就得重新确认门店，走完整绑定。
   *
   * ⚠️ 仅当远端**有**渠道账号标识时才是这个语义。没有标识的老记录点「新登录账号」
   * 要走 `startReauthByHotel` —— 那时用户的意思是「登一个能管这家店的账号」，
   * 门店不该变；走到这里会让他重选门店并改写绑定关系。
   */
  async function startNewLogin(): Promise<void> {
    if (!target || !channel) return;
    if (mode === 'backfill-hotel') {
      await startBackfillHotel();
      return;
    }
    if (canAnchorByHotel) {
      await startReauthByHotel();
      return;
    }
    dismissAppNotification(NOTIFICATION_ID);
    submitting = true;
    try {
      const { requestId } = await window.hotelButler.hotelManagement.startBinding();
      hotelBindingWaiting.set({
        requestId,
        newLoginChannel: { channelId: channel.id, url: channel.url },
        rmsHotelId: target.account.hotelId,
        rmsHotelName: target.rmsHotelName,
        // 这家酒店在本渠道已有绑定：换成别的门店必须先解绑，确认前就要拦住。
        replacingOtaHotelId: target.account.otaHotelId,
      });
      onClose();
      await push('/');
    } catch (reason) {
      log.warn('New login binding could not be started', {
        errorName: reason instanceof Error ? reason.name : 'UnknownError',
      });
      showAppNotification({
        id: NOTIFICATION_ID,
        title: '发起绑定失败',
        message: '请重试。',
        tone: 'error',
      });
    } finally {
      submitting = false;
    }
  }
</script>

<Dialog.Root open={target !== null} onOpenChange={(next) => !next && onClose()}>
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title class="text-lg">重新登录 · {channelName}</Dialog.Title>
      <Dialog.Description>
        {#if boundChannelAccountId !== null}
          登录成功后会核对是否为同一账号，门店绑定关系保持不变。
        {:else}
          {@const hotelLabel = target?.account.otaHotelName || target?.rmsHotelName || ''}
          {#if lastBoundCredentialId !== null}
            这条绑定没有记录渠道账号，已根据本机的门店记录推测出下面选中的账号。
          {:else}
            这条绑定没有记录渠道账号，无法确定原来用的是哪个，请自行选择或新登录一个。
          {/if}
          <!--
            抖音登录后会停在选公司页（这条路特意换了新 partition 逼它重新问，
            见 ReauthDialog.openForHotelAnchoredReauth）。不说清要选哪家，用户
            随手选一家就会核对失败——门店对不上并不代表账号选错了。
          -->
          {#if target?.account.source === 'douyin'}
            登录后请在页面中选择「{hotelLabel}」，选定后会自动核对，门店绑定关系保持不变。
          {:else}
            登录成功后会核对该账号是否管理「{hotelLabel}」，门店绑定关系保持不变。
          {/if}
        {/if}
      </Dialog.Description>
    </Dialog.Header>

    {#if loading}
      <div class="flex justify-center py-8"><Spinner aria-label="正在加载账号" /></div>
    {:else if credentials.length === 0}
      <p class="py-6 text-center text-sm text-muted-foreground">
        本机没有该渠道的登录账号，请新登录一个。
      </p>
    {:else if boundChannelAccountId !== null && identifiedCredential === undefined}
      <!-- 远端记着账号标识，但本机没有对应凭证：凭证已清理，或绑定发生在别的设备上。 -->
      <p class="py-6 text-center text-sm text-muted-foreground">
        本机没有这条绑定所用的账号（可能已清理，或绑定发生在其他设备上），请新登录一个。
      </p>
    {:else if identifiedCredential !== undefined}
      <!--
        远端记着账号标识且本机有对应凭证：该恢复哪个已经确定，列出其余账号只会
        诱导用户选一个必然核对失败的。要换账号走下面的「新登录账号」。
      -->
      {@const presentation = credentialPresentation(identifiedCredential)}
      <div class="rounded-md border px-3 py-2.5">
        <p class="text-sm">
          将恢复账号 <span class="font-medium">{presentation.title}</span>
        </p>
        {#if presentation.details.length > 0}
          <p class="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            {#each presentation.details as detail (detail.label)}
              <span>{detail.label} {detail.value}</span>
            {/each}
          </p>
        {/if}
      </div>
    {:else}
      <ul class="space-y-1 py-1">
        {#each pagination.items as credential (credential.id)}
          {@const presentation = credentialPresentation(credential)}
          <li>
            <label
              class="flex cursor-pointer items-start gap-3 rounded-md px-3 py-2 hover:bg-accent"
            >
              <input
                class="mt-1 shrink-0"
                type="radio"
                name="reauth-credential"
                value={credential.id}
                checked={selectedCredentialId === credential.id}
                onchange={() => (selectedCredentialId = credential.id)}
              />
              <span class="min-w-0 flex-1 text-sm">
                <span class="flex items-baseline gap-2">
                  <span class="min-w-0 truncate">{presentation.title}</span>
                  {#if credential.id === lastBoundCredentialId}
                    <span
                      class="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                    >
                      上次绑定过
                    </span>
                  {/if}
                </span>
                {#if presentation.details.length > 0}
                  <span
                    class="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground"
                  >
                    {#each presentation.details as detail (detail.label)}
                      <span>{detail.label} {detail.value}</span>
                    {/each}
                  </span>
                {/if}
              </span>
            </label>
          </li>
        {/each}
      </ul>
      <CredentialPager {pagination} disabled={submitting} />
    {/if}

    <Dialog.Footer class="sm:justify-between">
      <Button
        variant="outline"
        size="sm"
        disabled={submitting}
        onclick={() => void startNewLogin()}
      >
        <Plus />
        新登录账号
      </Button>
      <div class="flex gap-2">
        <Button variant="ghost" disabled={submitting} onclick={onClose}>取消</Button>
        {#if credentials.length > 0 && !(boundChannelAccountId !== null && identifiedCredential === undefined)}
          <Button disabled={!selectedCredentialId || submitting} onclick={() => void startReauth()}>
            {#if submitting}
              <Spinner aria-label="正在打开" />
              正在打开
            {:else}
              重新登录
            {/if}
          </Button>
        {/if}
      </div>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
