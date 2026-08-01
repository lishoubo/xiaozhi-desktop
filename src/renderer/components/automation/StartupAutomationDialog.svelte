<script lang="ts">
  import log from 'electron-log/renderer';
  import { onMount } from 'svelte';
  import { Button } from '$lib/components/ui/button';
  import * as Dialog from '$lib/components/ui/dialog';

  let open = $state(false);
  let message = $state('');

  onMount(() => {
    void window.hotelButler.automation
      .getCtripCheckIn()
      .then((result) => {
        if (!result) return;
        message = result.ok ? `获取到的今日携程入住时间为：${result.checkIn}` : result.message;
        open = true;
      })
      .catch((reason: unknown) => {
        log.warn('Startup automation result could not be loaded', {
          errorName: reason instanceof Error ? reason.name : 'UnknownError',
        });
        message = '暂时未获取到携程入住时间，请稍后重试';
        open = true;
      });
  });
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title>携程入住时间</Dialog.Title>
      <Dialog.Description>{message}</Dialog.Description>
    </Dialog.Header>
    <Dialog.Footer>
      <Button onclick={() => (open = false)}>知道了</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
