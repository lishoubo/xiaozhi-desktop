<script lang="ts">
  import Bot from '@lucide/svelte/icons/bot';
  import CircleUserRound from '@lucide/svelte/icons/circle-user-round';
  import Globe2 from '@lucide/svelte/icons/globe-2';
  import Menu from '@lucide/svelte/icons/menu';
  import Settings from '@lucide/svelte/icons/settings';
  import { link } from 'svelte-spa-router';
  import active from 'svelte-spa-router/active';
  import type { Snippet } from 'svelte';
  import { enter } from '../../motion';
  import { Button } from '$lib/components/ui/button';

  let { children }: { children: Snippet } = $props();
  let sidebarOpen = $state(true);

  const navigationClass =
    'grid size-11 place-items-center rounded-md text-muted-foreground no-underline transition-colors duration-150 ease-out hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none motion-reduce:transition-none [&.active]:bg-sidebar-accent [&.active]:text-sidebar-accent-foreground';
</script>

<div
  class={[
    'grid h-full bg-background transition-[grid-template-columns] duration-[180ms] ease-out motion-reduce:transition-none',
    sidebarOpen ? 'grid-cols-[80px_minmax(0,1fr)]' : 'grid-cols-[52px_minmax(0,1fr)]',
  ]}
>
  <aside
    class="flex min-w-0 flex-col items-center gap-5 overflow-hidden border-r border-sidebar-border bg-sidebar px-1.5 py-4"
    data-state={sidebarOpen ? 'open' : 'closed'}
  >
    <Button
      variant="ghost"
      size="icon"
      aria-label={sidebarOpen ? '收起侧边栏' : '展开侧边栏'}
      aria-controls="app-sidebar-navigation"
      aria-expanded={sidebarOpen}
      onclick={() => (sidebarOpen = !sidebarOpen)}
    >
      <Menu size={22} strokeWidth={1.9} />
    </Button>

    {#if sidebarOpen}
      <div
        class="grid size-10 shrink-0 select-none place-items-center rounded-lg bg-sidebar-primary text-sm font-semibold text-sidebar-primary-foreground"
        aria-label="小智酒店管家"
        in:enter={{ duration: 150, y: 0 }}
      >
        智
      </div>

      <nav
        id="app-sidebar-navigation"
        class="grid w-full justify-items-center gap-2"
        aria-label="应用导航"
        in:enter={{ duration: 150, y: 0 }}
      >
        <a
          class={navigationClass}
          href="/"
          use:link
          use:active={{ className: 'active' }}
          aria-label="浏览器"
        >
          <Globe2 size={22} strokeWidth={1.9} />
        </a>

        <a
          class={navigationClass}
          href="/agent"
          use:link
          use:active={{ className: 'active' }}
          aria-label="小智AI 管家"
        >
          <Bot size={22} strokeWidth={1.9} />
        </a>

        <a
          class={navigationClass}
          href="/profile"
          use:link
          use:active={{ className: 'active' }}
          aria-label="用户中心"
        >
          <CircleUserRound size={22} strokeWidth={1.9} />
        </a>

        <a
          class={navigationClass}
          href="/settings"
          use:link
          use:active={{ className: 'active' }}
          aria-label="设置"
        >
          <Settings size={22} strokeWidth={1.9} />
        </a>
      </nav>
    {/if}
  </aside>

  <section class="min-h-0 min-w-0 overflow-hidden">
    {@render children()}
  </section>
</div>
