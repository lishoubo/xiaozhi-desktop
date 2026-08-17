<script lang="ts">
  import type { BaseComponentProps } from '@json-render/svelte';
  import { PieChart } from 'layerchart';
  import * as Chart from '$lib/components/ui/chart';
  import type { HotelDistributionChartProps } from '../../../generative-ui/chart-types';

  let { props }: BaseComponentProps<HotelDistributionChartProps> = $props();

  const palette = [
    'var(--chart-1)',
    'var(--chart-2)',
    'var(--chart-3)',
    'var(--chart-4)',
    'var(--chart-5)',
  ];
  const data = $derived(
    props.items.map((item, index) => ({
      key: `segment-${index + 1}`,
      label: item.label,
      value: item.value,
      color: palette[index % palette.length],
    })),
  );
  const config = $derived(
    Object.fromEntries(
      data.map((item) => [item.key, { label: item.label, color: item.color }]),
    ) satisfies Chart.ChartConfig,
  );
  const total = $derived(props.items.reduce((sum, item) => sum + item.value, 0));
</script>

<section class="rounded-xl border border-border bg-card p-4 text-card-foreground">
  <header class="mb-3">
    <h3 class="m-0 text-sm font-semibold">{props.title}</h3>
    {#if props.description}<p class="mt-1 mb-0 text-xs text-muted-foreground">
        {props.description}
      </p>{/if}
  </header>
  <div class="grid items-center gap-4 sm:grid-cols-[minmax(0,1fr)_150px]">
    <Chart.Container {config} class="h-56 w-full aspect-auto">
      <PieChart
        {data}
        key="key"
        label="label"
        value="value"
        c="color"
        innerRadius={0.58}
        cornerRadius={5}
        padAngle={2}
      >
        {#snippet tooltip()}
          <Chart.Tooltip hideLabel />
        {/snippet}
      </PieChart>
    </Chart.Container>
    <div class="grid gap-2 text-xs">
      <p class="m-0 text-center text-sm font-semibold sm:text-left">
        {props.centerLabel ?? '合计'}
        {total.toLocaleString()}{props.unit ?? ''}
      </p>
      {#each data as item (item.key)}
        <div class="flex items-center justify-between gap-3">
          <span class="inline-flex min-w-0 items-center gap-2 text-muted-foreground">
            <span class="size-2.5 shrink-0 rounded-sm" style:background={item.color}></span>
            <span class="truncate">{item.label}</span>
          </span>
          <span class="font-medium tabular-nums">{item.value.toLocaleString()}</span>
        </div>
      {/each}
    </div>
  </div>
  {#if props.source}<p class="mt-3 mb-0 text-[11px] text-muted-foreground">
      来源：{props.source}
    </p>{/if}
</section>
