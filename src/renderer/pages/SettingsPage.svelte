<script lang="ts">
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import { createQuery } from '@tanstack/svelte-query';
  import { Button } from '$lib/components/ui/button';
  import { settingsListQueryOptions } from '$lib/data/settings';

  const settingsQuery = createQuery(settingsListQueryOptions);
</script>

<main class="h-full overflow-auto bg-secondary px-9 py-10">
  <div class="mx-auto max-w-4xl">
    <header class="mb-6 flex items-center justify-between gap-6">
      <h1 class="m-0 text-[28px] leading-tight font-semibold tracking-[-0.01em]">设置</h1>

      <Button
        variant="outline"
        disabled={settingsQuery.isFetching}
        onclick={() => void settingsQuery.refetch()}
      >
        <RefreshCw class={settingsQuery.isFetching ? 'animate-spin' : undefined} size={16} />
        刷新
      </Button>
    </header>

    <section class="min-h-44 rounded-lg border border-border bg-card p-6" aria-live="polite">
      <h2 class="m-0 text-base font-semibold">已保存的设置</h2>

      {#if settingsQuery.isPending}
        <p class="my-10 text-center text-sm text-muted-foreground">正在读取设置…</p>
      {:else if settingsQuery.isError}
        <p class="my-10 text-center text-sm text-destructive">
          读取失败：{settingsQuery.error.message}
        </p>
      {:else if settingsQuery.data.length === 0}
        <p class="my-10 text-center text-sm text-muted-foreground">目前还没有保存任何设置。</p>
      {:else}
        <dl class="mt-5 grid gap-2.5">
          {#each settingsQuery.data as setting (setting.key)}
            <div
              class="grid grid-cols-[minmax(180px,0.45fr)_minmax(0,1fr)] gap-5 rounded-md bg-muted px-4 py-3"
            >
              <dt class="font-medium">{setting.key}</dt>
              <dd
                class="m-0 min-w-0 [overflow-wrap:anywhere] font-mono text-[13px] text-muted-foreground"
              >
                {JSON.stringify(setting.value)}
              </dd>
            </div>
          {/each}
        </dl>
      {/if}
    </section>
  </div>
</main>
