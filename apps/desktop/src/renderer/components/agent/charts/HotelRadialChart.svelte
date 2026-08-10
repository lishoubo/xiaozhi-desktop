<script lang="ts">
  import type { BaseComponentProps } from '@json-render/svelte';
  import { ArcChart } from 'layerchart';
  import * as Chart from '$lib/components/ui/chart';
  import type { HotelRadialChartProps } from '../../../generative-ui/chart-types';

  let { props }: BaseComponentProps<HotelRadialChartProps> = $props();

  const value = $derived(Math.max(0, Math.min(props.max, props.value)));
  const data = $derived([{ key: 'value', label: props.label, value, color: 'var(--chart-1)' }]);
  const config = $derived({
    value: { label: props.label, color: 'var(--chart-1)' },
  } satisfies Chart.ChartConfig);
</script>

<section class="rounded-xl border border-border bg-card p-4 text-card-foreground">
  <header>
    <h3 class="m-0 text-sm font-semibold">{props.title}</h3>
    {#if props.description}<p class="mt-1 mb-0 text-xs text-muted-foreground">
        {props.description}
      </p>{/if}
  </header>
  <div class="relative mx-auto h-52 max-w-sm">
    <Chart.Container {config} class="h-full w-full aspect-auto">
      <ArcChart
        {data}
        key="key"
        label="label"
        value="value"
        c="color"
        maxValue={props.max}
        innerRadius={0.72}
        cornerRadius={8}
        trackCornerRadius={8}
        range={[-125, 125]}
      >
        {#snippet tooltip()}
          <Chart.Tooltip hideLabel />
        {/snippet}
      </ArcChart>
    </Chart.Container>
    <div class="pointer-events-none absolute inset-x-0 bottom-7 text-center">
      <p class="m-0 text-2xl font-semibold tracking-tight tabular-nums">
        {value.toLocaleString()}{props.unit ?? ''}
      </p>
      <p class="mt-1 mb-0 text-xs text-muted-foreground">{props.label}</p>
    </div>
  </div>
  {#if props.source}<p class="m-0 text-[11px] text-muted-foreground">来源：{props.source}</p>{/if}
</section>
