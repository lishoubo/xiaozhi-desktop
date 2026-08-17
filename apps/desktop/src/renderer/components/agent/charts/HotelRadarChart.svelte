<script lang="ts">
  import type { BaseComponentProps } from '@json-render/svelte';
  import type { HotelRadarChartProps } from '../../../generative-ui/chart-types';

  let { props }: BaseComponentProps<HotelRadarChartProps> = $props();

  const center = 120;
  const radius = 82;
  const levels = [0.25, 0.5, 0.75, 1] as const;
  const items = $derived(props.items.slice(0, 8));
  const hasBenchmark = $derived(items.some((item) => item.benchmark !== undefined));

  function coordinates(index: number, value: number): readonly [number, number] {
    const angle = (Math.PI * 2 * index) / items.length - Math.PI / 2;
    const distance = radius * Math.max(0, Math.min(1, value / props.max));
    return [center + Math.cos(angle) * distance, center + Math.sin(angle) * distance];
  }

  function polygon(value: number | ((index: number) => number)): string {
    return items
      .map((_, index) => {
        const nextValue = typeof value === 'function' ? value(index) : value;
        return coordinates(index, nextValue).join(',');
      })
      .join(' ');
  }

  const valuePoints = $derived(polygon((index) => items[index]?.value ?? 0));
  const benchmarkPoints = $derived(
    polygon((index) => items[index]?.benchmark ?? items[index]?.value ?? 0),
  );
</script>

<section class="rounded-xl border border-border bg-card p-4 text-card-foreground">
  <header class="mb-2">
    <h3 class="m-0 text-sm font-semibold">{props.title}</h3>
    {#if props.description}<p class="mt-1 mb-0 text-xs text-muted-foreground">
        {props.description}
      </p>{/if}
  </header>
  <div class="grid items-center gap-3 sm:grid-cols-[minmax(0,1fr)_150px]">
    <svg
      class="mx-auto h-64 w-full max-w-md overflow-visible"
      viewBox="0 0 240 240"
      role="img"
      aria-label={props.title}
    >
      {#each levels as level (level)}
        <polygon
          points={polygon(props.max * level)}
          fill="none"
          stroke="var(--border)"
          stroke-width="1"
        />
      {/each}
      {#each items as item, index (item.label)}
        {@const edge = coordinates(index, props.max)}
        {@const label = coordinates(index, props.max * 1.18)}
        <line
          x1={center}
          y1={center}
          x2={edge[0]}
          y2={edge[1]}
          stroke="var(--border)"
          stroke-width="1"
        />
        <text
          x={label[0]}
          y={label[1]}
          text-anchor="middle"
          dominant-baseline="middle"
          fill="var(--muted-foreground)"
          font-size="10"
        >
          {item.label}
        </text>
      {/each}
      {#if hasBenchmark}
        <polygon
          points={benchmarkPoints}
          fill="color-mix(in oklch, var(--chart-2) 10%, transparent)"
          stroke="var(--chart-2)"
          stroke-width="1.5"
          stroke-dasharray="4 3"
        />
      {/if}
      <polygon
        points={valuePoints}
        fill="color-mix(in oklch, var(--chart-1) 20%, transparent)"
        stroke="var(--chart-1)"
        stroke-width="2"
      />
      {#each items as item, index (item.label)}
        {@const point = coordinates(index, item.value)}
        <circle cx={point[0]} cy={point[1]} r="3.5" fill="var(--chart-1)">
          <title>{item.label}：{item.value} / {props.max}</title>
        </circle>
      {/each}
    </svg>
    <div class="grid gap-2 text-xs">
      {#each items as item (item.label)}
        <div class="flex items-center justify-between gap-3">
          <span class="truncate text-muted-foreground">{item.label}</span>
          <span class="font-medium tabular-nums">{item.value}</span>
        </div>
      {/each}
      <div
        class="mt-1 flex flex-wrap gap-3 border-t border-border pt-2 text-[11px] text-muted-foreground"
      >
        <span class="inline-flex items-center gap-1.5"
          ><span class="size-2 rounded-sm bg-[var(--chart-1)]"></span>{props.valueLabel}</span
        >
        {#if hasBenchmark}<span class="inline-flex items-center gap-1.5"
            ><span class="size-2 rounded-sm bg-[var(--chart-2)]"></span>{props.benchmarkLabel ??
              '基准'}</span
          >{/if}
      </div>
    </div>
  </div>
  {#if props.source}<p class="mt-2 mb-0 text-[11px] text-muted-foreground">
      来源：{props.source}
    </p>{/if}
</section>
