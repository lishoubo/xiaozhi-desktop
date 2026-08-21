<script lang="ts">
  import CircleUserRound from '@lucide/svelte/icons/circle-user-round';
  import CalendarDays from '@lucide/svelte/icons/calendar-days';
  import Globe2 from '@lucide/svelte/icons/globe-2';
  import Building2 from '@lucide/svelte/icons/building-2';
  import Menu from '@lucide/svelte/icons/menu';
  import Settings from '@lucide/svelte/icons/settings';
  import { link } from 'svelte-spa-router';
  import active from 'svelte-spa-router/active';
  import type { Snippet } from 'svelte';
  import { enter } from '../../motion';
  import AgentAvatar from '../agent/AgentAvatar.svelte';
  import AppNotificationCenter from './AppNotificationCenter.svelte';
  import { weekdayLabel } from '../../session-greeting';
  import { greetingName } from '../../session-greeting.svelte';
  import { capabilitiesOf, type SessionLike } from '../../permissions';
  import { Button } from '$lib/components/ui/button';

  // session 设为必填 prop：漏传即编译失败，不会静默退化成「全部隐藏」或「全部显示」。
  let { children, session }: { children: Snippet; session: SessionLike } = $props();
  let sidebarOpen = $state(true);

  // 会话在一次页面生命周期内不会变——变了必然经过登出、整页重建。
  const capabilities = $derived(capabilitiesOf(session));

  const welcomeName = $derived(greetingName());
  // 取一次即可：应用不会跨天常驻，为此挂个定时器不划算。
  const weekday = weekdayLabel(new Date());

  const navigationClass =
    'relative grid size-11 place-items-center rounded-md border-l-2 border-transparent text-muted-foreground no-underline transition-colors duration-150 ease-out before:absolute before:left-[-2px] before:h-5 before:w-0.5 before:rounded-full before:bg-transparent hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none motion-reduce:transition-none [&.active]:bg-sidebar-accent [&.active]:text-sidebar-accent-foreground [&.active]:before:bg-[var(--brand-green)]';
</script>

<div
  class={[
    'grid h-full bg-background transition-[grid-template-columns] duration-[180ms] ease-out motion-reduce:transition-none',
    sidebarOpen ? 'grid-cols-[80px_minmax(0,1fr)]' : 'grid-cols-[52px_minmax(0,1fr)]',
  ]}
>
  <AppNotificationCenter />
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
        class="relative grid size-10 shrink-0 select-none place-items-center rounded-lg bg-sidebar-primary text-sm font-semibold text-sidebar-primary-foreground after:absolute after:right-1 after:bottom-1 after:size-1.5 after:rounded-full after:bg-[var(--brand-green)]"
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
          class={`${navigationClass} group/agent`}
          href="/agent"
          use:link
          use:active={{ className: 'active' }}
          aria-label="小智AI 管家"
        >
          <AgentAvatar size="sm" online />
        </a>

        <a
          class={navigationClass}
          href="/calendar"
          use:link
          use:active={{ className: 'active' }}
          aria-label="日历"
        >
          <CalendarDays size={22} strokeWidth={1.9} />
        </a>

        <!-- 酒店管理只对服务商员工开放；酒店用户在浏览器工作区作业，不碰这个模块。 -->
        {#if capabilities.showHotelManagement}
          <a
            class={navigationClass}
            href="/hotels"
            use:link
            use:active={{ className: 'active' }}
            aria-label="酒店管理"
          >
            <Building2 size={22} strokeWidth={1.9} />
          </a>
        {/if}

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

  <!--
    内容区上方的通栏：只放欢迎语，所以不给它 `header` 语义，也不参与页面导航。
    各页面自己的顶部（小智页的 68px header、浏览器页的标签栏）保持原样，这条
    只是在它们之上多一行。
  -->
  <section class="grid min-h-0 min-w-0 grid-rows-[40px_minmax(0,1fr)] overflow-hidden">
    <div class="flex min-w-0 items-center justify-end border-b border-border bg-background px-5">
      {#if welcomeName}
        <p class="m-0 min-w-0 truncate text-xs text-muted-foreground">
          欢迎您，<span class="font-medium text-foreground">{welcomeName}</span>
          <span class="mx-1.5 text-border">·</span>今天是{weekday}
        </p>
      {/if}
    </div>

    <div class="min-h-0 min-w-0 overflow-hidden">
      {@render children()}
    </div>
  </section>
</div>
