<script lang="ts">
  import type { BrowserTab, OtaAccountDto } from '../../../shared/browser';
  import type { OtaChannel } from '../../data/ota-channels';
  import AddAccountPanel from './AddAccountPanel.svelte';

  type Props = Readonly<{
    channel: OtaChannel;
    activeTabId: string | undefined;
    accounts: readonly OtaAccountDto[];
    activeTabPartitionNames: ReadonlySet<string>;
    onSelectAccount: (account: OtaAccountDto) => void;
    onAccountCreated: (tab: BrowserTab) => void;
    onNewLogin: () => Promise<boolean>;
  }>;

  let {
    channel,
    activeTabId,
    accounts,
    activeTabPartitionNames,
    onSelectAccount,
    onAccountCreated,
    onNewLogin,
  }: Props = $props();
</script>

<nav
  class="flex min-w-0 items-center gap-1 overflow-x-auto border-b border-border px-4 py-1.5"
  aria-label="账号列表"
>
  {#each accounts as account (account.id)}
    <button
      class={[
        'flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs transition-colors duration-150 ease-out motion-reduce:transition-none',
        activeTabPartitionNames.has(account.partitionName)
          ? 'bg-accent text-accent-foreground'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      ]}
      type="button"
      title={account.otaHotelName ?? account.otaHotelId}
      onclick={() => onSelectAccount(account)}
    >
      <span
        class={[
          'size-1.5 shrink-0 rounded-full',
          activeTabPartitionNames.has(account.partitionName) ? 'bg-primary' : 'bg-muted-foreground/50',
        ]}
      ></span>
      <span class="max-w-40 truncate">{account.otaHotelName ?? account.otaHotelId}</span>
    </button>
  {/each}
  <AddAccountPanel {channel} {activeTabId} existingAccounts={accounts} {onAccountCreated} {onNewLogin} />
</nav>
