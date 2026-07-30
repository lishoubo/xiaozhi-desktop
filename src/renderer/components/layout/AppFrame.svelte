<script lang="ts">
  import Globe2 from '@lucide/svelte/icons/globe-2';
  import Settings from '@lucide/svelte/icons/settings';
  import { link } from 'svelte-spa-router';
  import active from 'svelte-spa-router/active';
  import type { Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();
</script>

<div class="grid h-full grid-cols-[80px_minmax(0,1fr)] bg-background">
  <aside
    class="flex flex-col items-center gap-8 border-r border-sidebar-border bg-sidebar px-2.5 py-5"
  >
    <div
      class="grid size-10 select-none place-items-center rounded-lg bg-sidebar-primary text-[13px] font-semibold tracking-[0.04em] text-sidebar-primary-foreground"
      aria-label="Hotel Butler"
    >
      HB
    </div>

    <nav class="grid w-full gap-1.5" aria-label="应用导航">
      <a
        class="grid justify-items-center gap-1 rounded-md px-1 py-2.5 text-xs font-medium text-muted-foreground no-underline transition-colors duration-150 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground [&.active]:bg-sidebar-accent [&.active]:text-sidebar-accent-foreground"
        href="/"
        use:link
        use:active={{ className: 'active' }}
      >
        <Globe2 size={18} strokeWidth={1.8} />
        <span>浏览器</span>
      </a>
      <a
        class="grid justify-items-center gap-1 rounded-md px-1 py-2.5 text-xs font-medium text-muted-foreground no-underline transition-colors duration-150 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground [&.active]:bg-sidebar-accent [&.active]:text-sidebar-accent-foreground"
        href="/settings"
        use:link
        use:active={{ className: 'active' }}
      >
        <Settings size={18} strokeWidth={1.8} />
        <span>设置</span>
      </a>
    </nav>
  </aside>

  <section class="min-h-0 min-w-0 overflow-hidden">
    {@render children()}
  </section>
</div>
