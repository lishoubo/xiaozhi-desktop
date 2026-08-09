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
    otaReauthWaiting,
  } from '../../hotel-management/cross-route-intents';
  import { credentialPresentation } from '../../hotel-management/credential-presentation';
  import { dismissAppNotification, showAppNotification } from '../../notifications';
  import { toPlainJson } from '../../ipc-payload';
  import { Button } from '$lib/components/ui/button';
  import { Spinner } from '$lib/components/ui/spinner';
  import * as Dialog from '$lib/components/ui/dialog';

  type Target = Readonly<{ account: RmsOtaAccountDto; rmsHotelName: string }>;
  type Props = { target: Target | null; onClose: () => void };
  const { target, onClose }: Props = $props();

  const NOTIFICATION_ID = 'ota-reauth-error';

  let loading = $state(false);
  let submitting = $state(false);
  let credentials = $state<OtaCredentialDto[]>([]);
  let lastBoundCredentialId = $state<string | null>(null);
  let selectedCredentialId = $state<string | undefined>(undefined);

  const channel = $derived(OTA_CHANNELS.find((item) => item.id === target?.account.source));
  const channelName = $derived(channel?.name ?? target?.account.source ?? '');

  async function loadCredentials(account: RmsOtaAccountDto): Promise<void> {
    loading = true;
    selectedCredentialId = undefined;
    lastBoundCredentialId = null;
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
      credentials = [...list];
      lastBoundCredentialId = matched;
      // 上次绑定过的那个默认选中——绝大多数情况用户要恢复的就是它。
      if (matched && list.some((item) => item.id === matched)) selectedCredentialId = matched;
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    if (target) void loadCredentials(target.account);
  });

  /** B 路：恢复这个账号，只刷新登录态。 */
  async function startReauth(): Promise<void> {
    const credential = credentials.find((item) => item.id === selectedCredentialId);
    if (!target || !credential) return;
    // 没有账号标识就没法核对身份，主进程那边一定会拒绝——不如在这里说清楚。
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

  /** A 路：换账号就得重新确认门店，走完整绑定。 */
  async function startNewLogin(): Promise<void> {
    if (!target || !channel) return;
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
        选择要恢复的账号；登录成功后会核对是否为同一账号，门店绑定关系保持不变。
      </Dialog.Description>
    </Dialog.Header>

    {#if loading}
      <div class="flex justify-center py-8"><Spinner aria-label="正在加载账号" /></div>
    {:else if credentials.length === 0}
      <p class="py-6 text-center text-sm text-muted-foreground">
        本机没有该渠道的登录账号，请新登录一个。
      </p>
    {:else}
      <ul class="max-h-72 space-y-1 overflow-y-auto py-1">
        {#each credentials as credential (credential.id)}
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
        {#if credentials.length > 0}
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
