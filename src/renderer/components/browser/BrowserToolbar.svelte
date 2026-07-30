<script lang="ts">
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import RotateCw from '@lucide/svelte/icons/rotate-cw';
  import { Button } from '$lib/components/ui/button';

  let address = 'https://example.com';
</script>

<header class="toolbar">
  <div class="window-title select-none">Hotel Butler</div>

  <nav class="navigation" aria-label="浏览器控制">
    <Button variant="ghost" size="icon" aria-label="后退" disabled>
      <ArrowLeft size={17} strokeWidth={1.8} />
    </Button>
    <Button variant="ghost" size="icon" aria-label="前进" disabled>
      <ArrowRight size={17} strokeWidth={1.8} />
    </Button>
    <Button variant="ghost" size="icon" aria-label="刷新" disabled>
      <RotateCw size={16} strokeWidth={1.8} />
    </Button>
  </nav>

  <input class="address" aria-label="网址" bind:value={address} spellcheck="false" />
</header>

<style>
  .toolbar {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 12px 18px;
    background: var(--background);
    border-bottom: 1px solid var(--border);
  }

  .window-title {
    font-weight: 700;
    white-space: nowrap;
  }

  .navigation {
    display: flex;
    gap: 6px;
  }

  .address {
    width: 100%;
    height: 38px;
    padding: 0 14px;
    border: 1px solid var(--input);
    border-radius: 9px;
    background: var(--background);
    color: var(--foreground);
    outline: none;
  }

  .address:focus {
    border-color: #5578ee;
    box-shadow: 0 0 0 3px rgb(85 120 238 / 14%);
  }
</style>
