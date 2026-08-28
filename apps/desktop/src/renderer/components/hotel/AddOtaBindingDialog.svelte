<script lang="ts">
  /**
   * 「新增绑定账号」的第一步：为某家 RMS 酒店选一个已登录的渠道账号。
   *
   * 选定后发起绑定并跳到浏览器工作区——后续的登录、探测、候选确认都在那边就地
   * 完成（用户否决候选后要能立刻换个渠道重试，跳回酒店页会把循环拆成往返）。
   */
  import Plus from '@lucide/svelte/icons/plus';
  import log from 'electron-log/renderer';
  import { errorFields } from '../../logging';
  import { push } from 'svelte-spa-router';
  import type { OtaCredentialDto } from '../../../shared/browser';
  import type { RmsHotelDto, RmsOtaAccountDto } from '../../../shared/hotel-management';
  import { BINDABLE_CHANNEL_IDS, OTA_CHANNELS } from '../../data/ota-channels';
  import { boundChannelsOfHotel } from '../../hotel-management/model';
  import { credentialPresentation } from '../../hotel-management/credential-presentation';
  import { hotelBindingWaiting } from '../../hotel-management/cross-route-intents';
  import { createPagination } from '../../hotel-management/paginate.svelte';
  import CredentialPager from './CredentialPager.svelte';
  import { dismissAppNotification, showAppNotification } from '../../notifications';
  import { Button } from '$lib/components/ui/button';
  import { Spinner } from '$lib/components/ui/spinner';
  import * as Dialog from '$lib/components/ui/dialog';

  type Props = {
    hotel: RmsHotelDto | null;
    /** 这家酒店的远端账号——用来算出哪些渠道已经占了绑定位。 */
    otaAccounts: readonly RmsOtaAccountDto[];
    onClose: () => void;
  };
  const { hotel, otaAccounts, onClose }: Props = $props();

  const NOTIFICATION_ID = 'hotel-add-binding-error';

  let loading = $state(false);
  let submitting = $state(false);
  let credentials = $state<OtaCredentialDto[]>([]);
  let selectedCredentialId = $state<string | undefined>(undefined);
  /** 多个可绑渠道时，「新登录账号」先展开渠道选择。 */
  let choosingNewLoginChannel = $state(false);

  const boundChannels = $derived(boundChannelsOfHotel(otaAccounts));
  /** 已绑定该渠道就整个渠道排除：同渠道换个账号一样会被远端拒绝。 */
  const selectableCredentials = $derived(
    credentials.filter((credential) => !boundChannels.has(credential.channel)),
  );
  const pagination = createPagination(() => selectableCredentials);
  /** 还能绑的渠道：支持绑定 且 尚未占位。 */
  const bindableChannels = $derived(
    OTA_CHANNELS.filter(
      (channel) => BINDABLE_CHANNEL_IDS.includes(channel.id) && !boundChannels.has(channel.id),
    ),
  );
  /** 全部渠道都绑满了——与「一个账号都没登录」是两回事，文案不同。 */
  const allChannelsBound = $derived(bindableChannels.length === 0);

  function channelName(channelId: string): string {
    return OTA_CHANNELS.find((item) => item.id === channelId)?.name ?? channelId;
  }

  async function loadCredentials(): Promise<void> {
    loading = true;
    selectedCredentialId = undefined;
    choosingNewLoginChannel = false;
    pagination.reset();
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

  /**
   * 发起绑定的公共部分：取号 → 存跨路由意图 → 跳浏览器工作区。两个入口的差别只在
   * 「开哪个标签页」——已有账号给 credentialId，新登录给渠道。
   */
  async function startBindingWith(
    target: { credentialId: string } | { newLoginChannel: { channelId: string; url: string } },
  ): Promise<void> {
    if (!hotel) return;
    dismissAppNotification(NOTIFICATION_ID);
    submitting = true;
    try {
      // 只取号：标签页由浏览器工作区那边打开（开 tab 之后的三步收尾依赖只有
      // 渲染进程才有的视口尺寸，而此刻浏览器视口还没挂载）。
      const { requestId } = await window.hotelButler.hotelManagement.startBinding();
      // 意图交给浏览器工作区：它挂载后开标签页并登记等待，候选到了就地弹窗。
      hotelBindingWaiting.set({
        requestId,
        ...target,
        rmsHotelId: hotel.id,
        rmsHotelName: hotel.name,
      });
      onClose();
      await push('/');
    } catch (reason) {
      log.warn('Hotel binding could not be started', {
        ...errorFields(reason),
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

  function startBinding(): Promise<void> {
    const credential = credentials.find((item) => item.id === selectedCredentialId);
    if (!credential) return Promise.resolve();
    return startBindingWith({ credentialId: credential.id });
  }

  /**
   * 「新登录账号」：该渠道还没有可用账号时的快捷入口。只有一个可绑渠道时直接开，
   * 多个时先让用户选——不替用户猜要登哪家。
   */
  function startNewLogin(channel?: { id: string; url: string }): Promise<void> {
    const target = channel ?? (bindableChannels.length === 1 ? bindableChannels[0] : undefined);
    if (!target) {
      choosingNewLoginChannel = true;
      return Promise.resolve();
    }
    return startBindingWith({
      newLoginChannel: { channelId: target.id, url: target.url },
    });
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
    {:else if allChannelsBound}
      <p class="py-6 text-center text-sm text-muted-foreground">
        该酒店已在全部支持的渠道完成绑定，无需新增。
      </p>
    {:else if choosingNewLoginChannel}
      <ul class="space-y-1 py-1" aria-label="选择要登录的渠道">
        {#each bindableChannels as channel (channel.id)}
          <li>
            <button
              type="button"
              class="flex w-full cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-accent"
              disabled={submitting}
              onclick={() => void startNewLogin(channel)}
            >
              <img class="size-4 shrink-0 object-contain" src={channel.iconUrl} alt="" />
              <span class="text-sm">{channel.name}</span>
            </button>
          </li>
        {/each}
      </ul>
    {:else if selectableCredentials.length === 0}
      <div class="space-y-3 py-6 text-center">
        <p class="m-0 text-sm text-muted-foreground">
          没有可绑定的账号{otaAccounts.length > 0 ? '——已绑定渠道下的账号不会出现在这里' : ''}。
        </p>
        <Button
          variant="outline"
          size="sm"
          disabled={submitting}
          onclick={() => void startNewLogin()}
        >
          <Plus />
          新登录账号
        </Button>
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
                name="binding-credential"
                value={credential.id}
                checked={selectedCredentialId === credential.id}
                onchange={() => (selectedCredentialId = credential.id)}
              />
              <span class="min-w-0 flex-1 text-sm">
                <span class="flex items-baseline gap-2">
                  <span class="shrink-0 text-muted-foreground">
                    {channelName(credential.channel)}
                  </span>
                  <span class="min-w-0 truncate">{presentation.title}</span>
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
      <button
        type="button"
        class="mt-1 self-start text-xs text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50"
        disabled={submitting}
        onclick={() => void startNewLogin()}
      >
        都不是？新登录一个账号
      </button>
    {/if}

    <Dialog.Footer>
      <Button variant="ghost" disabled={submitting} onclick={onClose}>取消</Button>
      {#if !choosingNewLoginChannel && !allChannelsBound && selectableCredentials.length > 0}
        <Button disabled={!selectedCredentialId || submitting} onclick={() => void startBinding()}>
          {#if submitting}
            <Spinner aria-label="正在打开" />
            正在打开
          {:else}
            打开浏览器并绑定
          {/if}
        </Button>
      {/if}
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
