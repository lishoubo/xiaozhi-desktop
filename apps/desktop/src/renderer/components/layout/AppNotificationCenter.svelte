<script lang="ts">
  import CircleAlert from '@lucide/svelte/icons/circle-alert';
  import Info from '@lucide/svelte/icons/info';
  import X from '@lucide/svelte/icons/x';
  import { autoAnimate } from '@formkit/auto-animate';
  import { Alert, AlertAction, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
  import { Button } from '$lib/components/ui/button';
  import { ALERT_ANIMATION_OPTIONS } from '../../motion';
  import {
    appNotifications,
    dismissAppNotification,
    type AppNotificationAction,
  } from '../../notifications';

  function runAction(id: string, action: AppNotificationAction): void {
    dismissAppNotification(id);
    void action.run();
  }
</script>

<aside
  class="pointer-events-none fixed top-4 right-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
  aria-label="系统通知"
  use:autoAnimate={ALERT_ANIMATION_OPTIONS}
>
  {#each $appNotifications as notification (notification.id)}
    <Alert
      variant={notification.tone === 'error' ? 'destructive' : 'default'}
      class="pointer-events-auto shadow-lg"
      data-notification-id={notification.id}
    >
      {#if notification.tone === 'error'}
        <CircleAlert />
      {:else}
        <Info />
      {/if}
      <AlertTitle>{notification.title}</AlertTitle>
      <AlertDescription class="pr-7">
        <span>{notification.message}</span>
        {#if notification.action}
          {@const action = notification.action}
          <Button
            variant="link"
            size="sm"
            class="ml-2 h-auto px-0"
            onclick={() => runAction(notification.id, action)}
          >
            {notification.action.label}
          </Button>
        {/if}
      </AlertDescription>
      <AlertAction>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`关闭${notification.title}通知`}
          onclick={() => dismissAppNotification(notification.id)}
        >
          <X />
        </Button>
      </AlertAction>
    </Alert>
  {/each}
</aside>
