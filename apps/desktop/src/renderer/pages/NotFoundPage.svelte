<script lang="ts">
  import { buttonVariants } from '$lib/components/ui/button';
  import { link } from 'svelte-spa-router';
  import { enter, PAGE_ENTER_OPTIONS } from '../motion';
</script>

<main
  class="grid h-full place-content-center justify-items-center bg-muted/40 text-center"
  data-motion="page"
  in:enter={PAGE_ENTER_OPTIONS}
>
  <p class="m-0 rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-foreground">
    404
  </p>
  <h1 class="mt-2 mb-5 text-[28px] leading-tight font-semibold">页面不存在</h1>
  <a class={buttonVariants()} href="/" use:link>返回浏览器</a>
</main>
