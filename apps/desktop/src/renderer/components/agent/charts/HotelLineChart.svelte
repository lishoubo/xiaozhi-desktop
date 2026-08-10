<script lang="ts">
  import type { BaseComponentProps } from '@json-render/svelte';
  import { LineChart } from 'layerchart';
  import * as Chart from '$lib/components/ui/chart';
  import type { HotelTrendChartProps } from '../../../generative-ui/chart-types';

  let { props }: BaseComponentProps<HotelTrendChartProps> = $props();

  const hasComparison = $derived(props.data.some((item) => item.comparison !== undefined));
  const config = $derived({
    value: { label: props.valueLabel, color: 'var(--chart-1)' },
    comparison: {
      label: props.comparisonLabel ?? '对比值',
      color: 'var(--chart-2)',
    },
  } satisfies Chart.ChartConfig);
  const series = $derived([
    { key: 'value', label: config.value.label, color: config.value.color },
    ...(hasComparison
      ? [{ key: 'comparison', label: config.comparison.label, color: config.comparison.color }]
      : []),
  ]);
</script>

<section class="rounded-xl border border-border bg-card p-4 text-card-foreground">
  <header class="mb-3">
    <h3 class="m-0 text-sm font-semibold">{props.title}</h3>
    {#if props.description}<p class="mt-1 mb-0 text-xs text-muted-foreground">
        {props.description}
      </p>{/if}
  </header>
  <Chart.Container {config} class="h-56 w-full aspect-auto">
    <LineChart data={props.data} x="label" axis="x" {series} legend={hasComparison}>
      {#snippet tooltip()}
        <Chart.Tooltip indicator="line" />
      {/snippet}
    </LineChart>
  </Chart.Container>
  {#if props.unit || props.source}
    <p class="mt-3 mb-0 text-[11px] text-muted-foreground">
      {[props.unit ? `单位：${props.unit}` : '', props.source ? `来源：${props.source}` : '']
        .filter(Boolean)
        .join(' · ')}
    </p>
  {/if}
</section>
