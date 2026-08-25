<script lang="ts">
  import CircleUserRound from '@lucide/svelte/icons/circle-user-round';
  import Menu from '@lucide/svelte/icons/menu';
  import { link } from 'svelte-spa-router';
  import active from 'svelte-spa-router/active';
  import type { Snippet } from 'svelte';
  import AppNotificationCenter from './AppNotificationCenter.svelte';
  import { weekdayLabel } from '../../session-greeting';
  import { greetingName } from '../../session-greeting.svelte';
  import { capabilitiesOf, type SessionLike } from '../../permissions';
  import { Button } from '$lib/components/ui/button';
  import logoUrl from '../../assets/xiaozhi-logo-3d.png';
  import browserNavUrl from '../../assets/nav-channels.png';
  import agentNavUrl from '../../assets/nav-chat.png';
  import calendarNavUrl from '../../assets/nav-tasks.png';
  import hotelNavUrl from '../../assets/nav-analytics.png';
  import settingsNavUrl from '../../assets/nav-settings.png';

  let { children, session }: { children: Snippet; session: SessionLike } = $props();
  let sidebarOpen = $state(true);

  const capabilities = $derived(capabilitiesOf(session));
  const welcomeName = $derived(greetingName());
  const avatarText = $derived((welcomeName || '用户').slice(0, 1).toUpperCase());
  const weekday = weekdayLabel(new Date());

  const navigationClass =
    'group relative flex h-[68px] w-full items-center rounded-[10px] text-[12px] font-medium text-sidebar-foreground no-underline transition-colors duration-150 hover:bg-[#f1f6f6] hover:text-[#078f8a] focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:outline-none [&.active]:bg-sidebar-accent [&.active]:font-semibold [&.active]:text-sidebar-accent-foreground';
  const navigationImageClass =
    'size-9 shrink-0 object-contain opacity-85 saturate-[.72] transition-[filter,opacity] group-hover:opacity-100 group-[.active]:opacity-100 group-[.active]:saturate-100';
</script>

<div class="grid h-full min-h-0 grid-rows-[58px_minmax(0,1fr)] bg-[var(--app-canvas)]">
  <AppNotificationCenter />

  <header
    class="flex min-w-0 items-center border-b border-black/[0.035] px-5"
    aria-label="应用标题栏"
  >
    <div class="flex min-w-0 items-center gap-2.5">
      <img class="size-8 object-contain" src={logoUrl} alt="" />
      <strong class="truncate text-[17px] font-semibold tracking-[-0.025em]">小智管家</strong>
    </div>
    <div class="ml-auto flex min-w-0 items-center gap-3">
      {#if welcomeName}
        <p class="m-0 min-w-0 truncate text-xs text-muted-foreground">
          欢迎您，<span class="font-medium text-foreground">{welcomeName}</span>
          <span class="mx-1.5 text-border">·</span>今天是{weekday}
        </p>
      {/if}
      <span
        class="grid size-8 shrink-0 place-items-center rounded-full bg-[#e8ebee] text-xs font-semibold text-[#3f4855]"
      >
        {avatarText}
      </span>
    </div>
  </header>

  <div
    class={[
      'm-2 mt-0 grid min-h-0 overflow-hidden rounded-[18px] border border-[#e7ebef] bg-background shadow-[var(--shadow-card)] transition-[grid-template-columns] duration-200 motion-reduce:transition-none',
      sidebarOpen ? 'grid-cols-[104px_minmax(0,1fr)]' : 'grid-cols-[68px_minmax(0,1fr)]',
    ]}
  >
    <aside
      class="flex min-h-0 min-w-0 flex-col items-center overflow-hidden border-r border-sidebar-border bg-sidebar px-2 py-3"
      data-state={sidebarOpen ? 'open' : 'closed'}
    >
      <img class="mb-2 size-12 shrink-0 object-contain" src={logoUrl} alt="小智管家" />

      <nav class="grid w-full gap-1 overflow-y-auto" aria-label="应用导航">
        <a
          class={navigationClass}
          href="/"
          use:link
          use:active={{ className: 'active' }}
          aria-label="渠道管理"
          title="渠道管理"
        >
          <span class="flex w-full flex-col items-center justify-center gap-0.5">
            <img class={navigationImageClass} src={browserNavUrl} alt="" />
            {#if sidebarOpen}<span>渠道管理</span>{/if}
          </span>
        </a>
        <a
          class={navigationClass}
          href="/agent"
          use:link
          use:active={{ className: 'active' }}
          aria-label="小智AI 管家"
          title="AI 助理"
        >
          <span class="flex w-full flex-col items-center justify-center gap-0.5">
            <img class={navigationImageClass} src={agentNavUrl} alt="" />
            {#if sidebarOpen}<span>AI 助理</span>{/if}
          </span>
        </a>
        <a
          class={navigationClass}
          href="/calendar"
          use:link
          use:active={{ className: 'active' }}
          aria-label="运营日历"
          title="运营日历"
        >
          <span class="flex w-full flex-col items-center justify-center gap-0.5">
            <img class={navigationImageClass} src={calendarNavUrl} alt="" />
            {#if sidebarOpen}<span>运营日历</span>{/if}
          </span>
        </a>
        {#if capabilities.showHotelManagement}
          <a
            class={navigationClass}
            href="/hotels"
            use:link
            use:active={{ className: 'active' }}
            aria-label="酒店管理"
            title="酒店管理"
          >
            <span class="flex w-full flex-col items-center justify-center gap-0.5">
              <img class={navigationImageClass} src={hotelNavUrl} alt="" />
              {#if sidebarOpen}<span>酒店管理</span>{/if}
            </span>
          </a>
        {/if}
        <a
          class={navigationClass}
          href="/profile"
          use:link
          use:active={{ className: 'active' }}
          aria-label="用户中心"
          title="用户中心"
        >
          <span class="flex w-full flex-col items-center justify-center gap-1">
            <CircleUserRound size={24} strokeWidth={1.65} />
            {#if sidebarOpen}<span>用户中心</span>{/if}
          </span>
        </a>
        <a
          class={navigationClass}
          href="/settings"
          use:link
          use:active={{ className: 'active' }}
          aria-label="设置"
          title="设置"
        >
          <span class="flex w-full flex-col items-center justify-center gap-0.5">
            <img class={navigationImageClass} src={settingsNavUrl} alt="" />
            {#if sidebarOpen}<span>设置</span>{/if}
          </span>
        </a>
      </nav>

      <Button
        class="mt-auto size-9 shrink-0 rounded-[9px] border border-border bg-white text-muted-foreground shadow-xs hover:bg-[#f1f6f6] hover:text-[#078f8a]"
        variant="ghost"
        size="icon"
        aria-label={sidebarOpen ? '收起侧边栏' : '展开侧边栏'}
        aria-expanded={sidebarOpen}
        onclick={() => (sidebarOpen = !sidebarOpen)}
      >
        <Menu size={18} strokeWidth={1.8} />
      </Button>
    </aside>

    <div class="min-h-0 min-w-0 overflow-hidden bg-background">
      {@render children()}
    </div>
  </div>
</div>
