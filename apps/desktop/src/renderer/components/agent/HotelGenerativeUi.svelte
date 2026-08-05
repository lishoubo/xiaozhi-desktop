<script lang="ts">
  import { JsonUIProvider, Renderer } from '@json-render/svelte';
  import type { Spec } from '@json-render/core';
  import { hotelGenerativeUiRegistry } from '../../generative-ui/registry';

  let { spec }: { spec: Spec } = $props();
</script>

<div class="hotel-generative-ui min-w-0" data-generative-ui="hotel">
  <JsonUIProvider initialState={spec.state ?? {}} registry={hotelGenerativeUiRegistry}>
    <Renderer {spec} registry={hotelGenerativeUiRegistry} />
  </JsonUIProvider>
</div>
