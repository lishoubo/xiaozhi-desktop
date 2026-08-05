import { shadcnComponents } from '@json-render/shadcn-svelte';
import { defineRegistry } from '@json-render/svelte';
import { hotelGenerativeUiCatalog } from './catalog';

export const { registry: hotelGenerativeUiRegistry } = defineRegistry(hotelGenerativeUiCatalog, {
  components: shadcnComponents,
});
