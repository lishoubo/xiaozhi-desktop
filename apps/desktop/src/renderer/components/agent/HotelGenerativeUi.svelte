<script lang="ts">
  import { JsonUIProvider, Renderer } from '@json-render/svelte';
  import type { Spec } from '@json-render/core';
  import { hotelGenerativeUiRegistry } from '../../generative-ui/registry';

  let { spec }: { spec: Spec } = $props();
</script>

<div class="hotel-generative-ui w-full min-w-0" data-generative-ui="hotel">
  <JsonUIProvider initialState={spec.state ?? {}} registry={hotelGenerativeUiRegistry}>
    <Renderer {spec} registry={hotelGenerativeUiRegistry} />
  </JsonUIProvider>
</div>

<style>
  .hotel-generative-ui > :global(*) {
    width: 100%;
  }

  .hotel-generative-ui > :global(*) > :global(*) {
    width: 100%;
  }

  .hotel-generative-ui :global([data-slot='table-container']) {
    max-width: 100%;
    overscroll-behavior-inline: contain;
  }

  .hotel-generative-ui :global([data-slot='table']) {
    min-width: max-content;
  }
</style>
