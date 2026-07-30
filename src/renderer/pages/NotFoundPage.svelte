<script lang="ts">
  import { buttonVariants } from '$lib/components/ui/button';
  import { link } from 'svelte-spa-router';
</script>

<main class="grid h-full place-content-center justify-items-center bg-secondary text-center">
  <p class="m-0 text-sm font-semibold text-primary">404</p>
  <h1 class="mt-2 mb-5 text-[28px] leading-tight font-semibold">页面不存在</h1>
  <a class={buttonVariants()} href="/" use:link>返回浏览器</a>
</main>
