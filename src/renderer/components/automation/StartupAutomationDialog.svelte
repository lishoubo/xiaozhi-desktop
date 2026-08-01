<script lang="ts">
  import log from 'electron-log/renderer';
  import { autoAnimate } from '@formkit/auto-animate';
  import { onMount } from 'svelte';
  import CalendarCheck2 from '@lucide/svelte/icons/calendar-check-2';
  import CircleAlert from '@lucide/svelte/icons/circle-alert';
  import { ALERT_ANIMATION_OPTIONS } from '../../alert-animation';
  import * as Alert from '$lib/components/ui/alert';

  const AUTO_DISMISS_MS = 5_000;
  let visible = $state(false);
  let message = $state('');
  let success = $state(false);
  let dismissTimer: number | undefined;

  function showNotice(): void {
    visible = true;
    window.clearTimeout(dismissTimer);
    dismissTimer = window.setTimeout(() => {
      visible = false;
    }, AUTO_DISMISS_MS);
  }

  onMount(() => {
    let mounted = true;
    void window.hotelButler.automation
      .getCtripCheckIn()
      .then((result) => {
        if (!mounted || !result) return;
        success = result.ok;
        message = result.ok ? `获取到的今日携程入住时间为：${result.checkIn}` : result.message;
        showNotice();
      })
      .catch((reason: unknown) => {
        if (!mounted) return;
        log.warn('Startup automation result could not be loaded', {
          errorName: reason instanceof Error ? reason.name : 'UnknownError',
        });
        success = false;
        message = '暂时未获取到携程入住时间，请稍后重试';
        showNotice();
      });
    return () => {
      mounted = false;
      window.clearTimeout(dismissTimer);
    };
  });
</script>

<div
  class="pointer-events-none fixed top-4 right-4 z-40 w-[calc(100%-2rem)] max-w-[22rem]"
  aria-live="polite"
  use:autoAnimate={ALERT_ANIMATION_OPTIONS}
>
  {#if visible}
    <Alert.Root variant={success ? 'default' : 'destructive'} role="status" class="shadow-lg">
      {#if success}<CalendarCheck2 />{:else}<CircleAlert />{/if}
      <Alert.Title>{success ? '携程入住时间' : '获取失败'}</Alert.Title>
      <Alert.Description>{message}</Alert.Description>
    </Alert.Root>
  {/if}
</div>
