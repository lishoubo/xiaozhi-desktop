import { shadcnComponents } from '@json-render/shadcn-svelte';
import { defineRegistry } from '@json-render/svelte';
import { hotelGenerativeUiCatalog } from './catalog';
import HotelAreaChart from '../components/agent/charts/HotelAreaChart.svelte';
import HotelBarChart from '../components/agent/charts/HotelBarChart.svelte';
import HotelDonutChart from '../components/agent/charts/HotelDonutChart.svelte';
import HotelLineChart from '../components/agent/charts/HotelLineChart.svelte';
import HotelRadarChart from '../components/agent/charts/HotelRadarChart.svelte';
import HotelRadialChart from '../components/agent/charts/HotelRadialChart.svelte';

export const { registry: hotelGenerativeUiRegistry } = defineRegistry(hotelGenerativeUiCatalog, {
  components: {
    ...shadcnComponents,
    HotelAreaChart,
    HotelBarChart,
    HotelDonutChart,
    HotelLineChart,
    HotelRadarChart,
    HotelRadialChart,
  },
});
