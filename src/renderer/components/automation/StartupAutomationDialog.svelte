<script lang="ts">
  import log from 'electron-log/renderer';
  import { onMount } from 'svelte';
  import { showAppNotification } from '../../notifications';

  onMount(() => {
    let mounted = true;
    void window.hotelButler.automation
      .getCtripCheckIn()
      .then((result) => {
        if (!mounted || !result) return;
        showAppNotification({
          id: 'startup-ctrip-check-in',
          title: result.ok ? '携程入住时间' : '获取失败',
          message: result.ok ? `获取到的今日携程入住时间为：${result.checkIn}` : result.message,
          tone: result.ok ? 'default' : 'error',
        });
      })
      .catch((reason: unknown) => {
        if (!mounted) return;
        log.warn('Startup automation result could not be loaded', {
          errorName: reason instanceof Error ? reason.name : 'UnknownError',
        });
        showAppNotification({
          id: 'startup-ctrip-check-in',
          title: '获取失败',
          message: '暂时未获取到携程入住时间，请稍后重试',
          tone: 'error',
        });
      });
    return () => {
      mounted = false;
    };
  });
</script>
