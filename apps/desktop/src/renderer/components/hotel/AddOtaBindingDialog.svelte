<script lang="ts">
  /**
   * 「新增绑定账号」的第一步：为某家 RMS 酒店选一个已登录的渠道账号。
   *
   * 选定后发起绑定并跳到浏览器工作区——后续的登录、探测、候选确认都在那边就地
   * 完成（用户否决候选后要能立刻换个渠道重试，跳回酒店页会把循环拆成往返）。
   */
  import log from 'electron-log/renderer';
  import { push } from 'svelte-spa-router';
  import type { OtaCredentialDto } from '../../../shared/browser';
  import type { RmsHotelDto } from '../../../shared/hotel-management';
  import { OTA_CHANNELS } from '../../data/ota-channels';
  import { hotelBindingWaiting } from '../../hotel-management/cross-route-intents';
  import { dismissAppNotification, showAppNotification } from '../../notifications';
  import { Button } from '$lib/components/ui/button';
  import { Spinner } from '$lib/components/ui/spinner';
  import * as Dialog from '$lib/components/ui/dialog';

  type Props = { hotel: RmsHotelDto | null; onClose: () => void };
  const { hotel, onClose }: Props = $props();

  const NOTIFICATION_ID = 'hotel-add-binding-error';

  let loading = $state(false);
  let submitting = $state(false);
  let credentials = $state<OtaCredentialDto[]>([]);
  let selectedCredentialId = $state<string | undefined>(undefined);

  function channelName(channelId: string): string {
    return OTA_CHANNELS.find((item) => item.id === channelId)?.name ?? channelId;
  }

  /** 凭据没有酒店名时退回展示渠道账号 ID，避免出现空白行。 */
  function credentialLabel(credential: OtaCredentialDto): string {
    const extra = credential.credentialExtra;
    const hotelName = typeof extra?.hotelName === 'string' ? extra.hotelName : null;
    const name = typeof extra?.name === 'string' ? extra.name : null;
    return hotelName ?? name ?? credential.channelAccountId ?? credential.id;
  }

  async function loadCredentials(): Promise<void> {
    loading = true;
    selectedCredentialId = undefined;
    try {
      const perChannel = await Promise.all(
        OTA_CHANNELS.map((channel) =>
          window.hotelButler.otaCredential.listByChannel(channel.id).catch(() => []),
        ),
      );
      credentials = perChannel.flat();
    } finally {
      loading = false;
    }
  }

  // 弹窗每次打开都重新拉一次：用户可能刚在浏览器页登录了新账号。
  $effect(() => {
    if (hotel) void loadCredentials();
  });

  async function startBinding(): Promise<void> {
    const credential = credentials.find((item) => item.id === selectedCredentialId);
    if (!hotel || !credential) return;
    dismissAppNotification(NOTIFICATION_ID);
    submitting = true;
    try {
      // 只取号：标签页由浏览器工作区那边打开（开 tab 之后的三步收尾依赖只有
      // 渲染进程才有的视口尺寸，而此刻浏览器视口还没挂载）。
      const { requestId } = await window.hotelButler.hotelManagement.startBinding();
      // 意图交给浏览器工作区：它挂载后开标签页并登记等待，候选到了就地弹窗。
      hotelBindingWaiting.set({
        requestId,
        credentialId: credential.id,
        rmsHotelId: hotel.id,
        rmsHotelName: hotel.name,
      });
      onClose();
      await push('/');
    } catch (reason) {
      log.warn('Hotel binding could not be started', {
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

<Dialog.Root open={hotel !== null} onOpenChange={(next) => !next && onClose()}>
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title class="text-lg">新增绑定账号</Dialog.Title>
      <Dialog.Description>
        为「{hotel?.name}」选择一个已登录的渠道账号，随后在浏览器中确认要绑定的门店。
      </Dialog.Description>
    </Dialog.Header>

    {#if loading}
      <div class="flex justify-center py-8"><Spinner aria-label="正在加载账号" /></div>
    {:else if credentials.length === 0}
      <p class="py-6 text-center text-sm text-muted-foreground">
        暂无已登录的渠道账号，请先在浏览器中登录。
      </p>
    {:else}
      <ul class="max-h-72 space-y-1 overflow-y-auto py-1">
        {#each credentials as credential (credential.id)}
          <li>
            <label
              class="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 hover:bg-accent"
            >
              <input
                type="radio"
                name="binding-credential"
                value={credential.id}
                checked={selectedCredentialId === credential.id}
                onchange={() => (selectedCredentialId = credential.id)}
              />
              <span class="min-w-0 text-sm">
                <span class="text-muted-foreground">{channelName(credential.channel)}</span>
                <span class="ml-2">{credentialLabel(credential)}</span>
              </span>
            </label>
          </li>
        {/each}
      </ul>
    {/if}

    <Dialog.Footer>
      <Button variant="ghost" disabled={submitting} onclick={onClose}>取消</Button>
      <Button disabled={!selectedCredentialId || submitting} onclick={() => void startBinding()}>
        {#if submitting}
          <Spinner aria-label="正在打开" />
          正在打开
        {:else}
          打开浏览器并绑定
        {/if}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
