<script lang="ts">
  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import RotateCw from '@lucide/svelte/icons/rotate-cw';
  import { Button } from '$lib/components/ui/button';

  let address = 'https://example.com';
</script>

<header class="flex items-center gap-3 border-b border-border bg-background px-5 py-3">
  <div class="select-none whitespace-nowrap text-sm font-semibold">Hotel Butler</div>

  <nav class="flex gap-1" aria-label="浏览器控制">
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

  <input
    class="h-11 w-full rounded-md border border-input bg-background px-4 text-sm text-foreground outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-muted-foreground focus:border-ring focus:ring-3 focus:ring-ring/15"
    aria-label="网址"
    bind:value={address}
    spellcheck="false"
  />
</header>
