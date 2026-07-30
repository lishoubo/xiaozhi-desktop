<script lang="ts">
  import Globe2 from '@lucide/svelte/icons/globe-2';
  import Settings from '@lucide/svelte/icons/settings';
  import { link } from 'svelte-spa-router';
  import active from 'svelte-spa-router/active';
  import type { Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();
</script>

<div class="app-frame">
  <aside class="sidebar">
    <div class="brand" aria-label="Hotel Butler">HB</div>

    <nav class="app-navigation" aria-label="应用导航">
      <a href="/" use:link use:active={{ className: 'active' }}>
        <Globe2 size={19} strokeWidth={1.8} />
        <span>浏览器</span>
      </a>
      <a href="/settings" use:link use:active={{ className: 'active' }}>
        <Settings size={19} strokeWidth={1.8} />
        <span>设置</span>
      </a>
    </nav>
  </aside>

  <section class="route-content">
    {@render children()}
  </section>
</div>

<style>
  .app-frame {
    display: grid;
    grid-template-columns: 84px minmax(0, 1fr);
    height: 100%;
    background: var(--background);
  }

  .sidebar {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 28px;
    padding: 18px 10px;
    border-right: 1px solid var(--border);
    background: var(--sidebar);
  }

  .brand {
    display: grid;
    width: 42px;
    height: 42px;
    place-items: center;
    border-radius: 12px;
    color: var(--primary-foreground);
    background: var(--primary);
    font-size: 13px;
    font-weight: 750;
    letter-spacing: 0.04em;
  }

  .app-navigation {
    display: grid;
    gap: 8px;
    width: 100%;
  }

  .app-navigation a {
    display: grid;
    justify-items: center;
    gap: 5px;
    padding: 10px 4px;
    border-radius: 10px;
    color: var(--muted-foreground);
    font-size: 12px;
    font-weight: 600;
    text-decoration: none;
    transition:
      color 120ms ease,
      background 120ms ease;
  }

  .app-navigation a:hover,
  .app-navigation a:global(.active) {
    color: var(--sidebar-accent-foreground);
    background: var(--sidebar-accent);
  }

  .route-content {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }
</style>
