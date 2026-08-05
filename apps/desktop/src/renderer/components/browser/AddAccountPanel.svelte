<script lang="ts">
  import Plus from '@lucide/svelte/icons/plus';
  import { dismissAppNotification } from '../../notifications';
  import { Button } from '$lib/components/ui/button';
  import { Spinner } from '$lib/components/ui/spinner';

  let { onNewLogin }: { onNewLogin: () => Promise<boolean> } = $props();

  let busy = $state(false);

  async function newLogin(): Promise<void> {
    dismissAppNotification('add-account-error');
    busy = true;
    try {
      await onNewLogin();
    } finally {
      busy = false;
    }
  }
</script>

<Button
  variant="ghost"
  size="sm"
  class="h-7 shrink-0 gap-1 px-2 text-xs"
  disabled={busy}
  onclick={() => void newLogin()}
>
  {#if busy}<Spinner class="size-3.5" />{:else}<Plus size={13} strokeWidth={1.8} />{/if}
  添加账号
</Button>
