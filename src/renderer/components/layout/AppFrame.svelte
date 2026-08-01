<script lang="ts">
  import Globe2 from '@lucide/svelte/icons/globe-2';
  import Bot from '@lucide/svelte/icons/bot';
  import Settings from '@lucide/svelte/icons/settings';
  import CircleUserRound from '@lucide/svelte/icons/circle-user-round';
  import { link } from 'svelte-spa-router';
  import active from 'svelte-spa-router/active';
  import type { Snippet } from 'svelte';
  import * as Tooltip from '$lib/components/ui/tooltip';

  let { children }: { children: Snippet } = $props();
</script>

<div class="grid h-full grid-cols-[64px_minmax(0,1fr)] bg-background">
  <aside
    class="flex flex-col items-center gap-7 border-r border-sidebar-border bg-sidebar px-2 py-5"
  >
    <div
      class="grid size-9 select-none place-items-center rounded-lg bg-sidebar-primary text-sm font-semibold text-sidebar-primary-foreground"
      aria-label="小智酒店管家"
    >
      智
    </div>

    <Tooltip.Provider delayDuration={200}>
      <nav class="grid w-full gap-1.5" aria-label="应用导航">
        <Tooltip.Root>
          <Tooltip.Trigger>
            {#snippet child({ props })}
              <a
                {...props}
                class="grid size-10 place-items-center rounded-md text-muted-foreground no-underline transition-colors duration-150 ease-out hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none motion-reduce:transition-none [&.active]:bg-sidebar-accent [&.active]:text-sidebar-accent-foreground"
                href="/"
                use:link
                use:active={{ className: 'active' }}
                aria-label="浏览器"
              >
                <Globe2 size={19} strokeWidth={1.8} />
              </a>
            {/snippet}
          </Tooltip.Trigger>
          <Tooltip.Content side="right" sideOffset={8}>浏览器</Tooltip.Content>
        </Tooltip.Root>

        <Tooltip.Root>
          <Tooltip.Trigger>
            {#snippet child({ props })}
              <a
                {...props}
                class="grid size-10 place-items-center rounded-md text-muted-foreground no-underline transition-colors duration-150 ease-out hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none motion-reduce:transition-none [&.active]:bg-sidebar-accent [&.active]:text-sidebar-accent-foreground"
                href="/agent"
                use:link
                use:active={{ className: 'active' }}
                aria-label="小智AI 管家"
              >
                <Bot size={19} strokeWidth={1.8} />
              </a>
            {/snippet}
          </Tooltip.Trigger>
          <Tooltip.Content side="right" sideOffset={8}>小智AI 管家</Tooltip.Content>
        </Tooltip.Root>

        <Tooltip.Root>
          <Tooltip.Trigger>
            {#snippet child({ props })}
              <a
                {...props}
                class="grid size-10 place-items-center rounded-md text-muted-foreground no-underline transition-colors duration-150 ease-out hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none motion-reduce:transition-none [&.active]:bg-sidebar-accent [&.active]:text-sidebar-accent-foreground"
                href="/profile"
                use:link
                use:active={{ className: 'active' }}
                aria-label="用户中心"
              >
                <CircleUserRound size={19} strokeWidth={1.8} />
              </a>
            {/snippet}
          </Tooltip.Trigger>
          <Tooltip.Content side="right" sideOffset={8}>用户中心</Tooltip.Content>
        </Tooltip.Root>

        <Tooltip.Root>
          <Tooltip.Trigger>
            {#snippet child({ props })}
              <a
                {...props}
                class="grid size-10 place-items-center rounded-md text-muted-foreground no-underline transition-colors duration-150 ease-out hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none motion-reduce:transition-none [&.active]:bg-sidebar-accent [&.active]:text-sidebar-accent-foreground"
                href="/settings"
                use:link
                use:active={{ className: 'active' }}
                aria-label="设置"
              >
                <Settings size={19} strokeWidth={1.8} />
              </a>
            {/snippet}
          </Tooltip.Trigger>
          <Tooltip.Content side="right" sideOffset={8}>设置</Tooltip.Content>
        </Tooltip.Root>
      </nav>
    </Tooltip.Provider>
  </aside>

  <section class="min-h-0 min-w-0 overflow-hidden">
    {@render children()}
  </section>
</div>
