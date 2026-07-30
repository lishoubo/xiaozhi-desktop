<script lang="ts">
  import Database from '@lucide/svelte/icons/database';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import { createQuery } from '@tanstack/svelte-query';
  import { Button } from '$lib/components/ui/button';
  import { settingsListQueryOptions } from '$lib/data/settings';

  const settingsQuery = createQuery(settingsListQueryOptions);
</script>

<main class="settings-page">
  <header class="page-header">
    <div>
      <p class="eyebrow">应用数据</p>
      <h1>本地设置</h1>
      <p>这些数据通过 TanStack Query 缓存，并由 Electron 主进程持久化到 SQLite。</p>
    </div>

    <Button
      variant="outline"
      disabled={settingsQuery.isFetching}
      onclick={() => void settingsQuery.refetch()}
    >
      <RefreshCw class={settingsQuery.isFetching ? 'animate-spin' : undefined} size={16} />
      刷新
    </Button>
  </header>

  <section class="settings-card" aria-live="polite">
    <div class="card-title">
      <Database size={18} strokeWidth={1.8} />
      <h2>缓存中的设置</h2>
    </div>

    {#if settingsQuery.isPending}
      <p class="state-message">正在读取本地数据库…</p>
    {:else if settingsQuery.isError}
      <p class="state-message error">读取失败：{settingsQuery.error.message}</p>
    {:else if settingsQuery.data.length === 0}
      <p class="state-message">目前还没有保存任何设置。</p>
    {:else}
      <dl class="settings-list">
        {#each settingsQuery.data as setting (setting.key)}
          <div>
            <dt>{setting.key}</dt>
            <dd>{JSON.stringify(setting.value)}</dd>
          </div>
        {/each}
      </dl>
    {/if}
  </section>
</main>

<style>
  .settings-page {
    height: 100%;
    overflow: auto;
    padding: 36px;
    background: #f7f8fb;
  }

  .page-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 24px;
    max-width: 960px;
    margin: 0 auto 24px;
  }

  .eyebrow {
    margin: 0 0 6px;
    color: #5578ee;
    font-size: 12px;
    font-weight: 750;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  h1 {
    margin: 0;
    font-size: 28px;
  }

  .page-header p:last-child {
    margin: 8px 0 0;
    color: var(--muted-foreground);
  }

  .settings-card {
    max-width: 960px;
    min-height: 180px;
    margin: 0 auto;
    padding: 24px;
    border: 1px solid var(--border);
    border-radius: 14px;
    background: var(--card);
    box-shadow: 0 8px 30px rgb(15 23 42 / 5%);
  }

  .card-title {
    display: flex;
    align-items: center;
    gap: 9px;
  }

  h2 {
    margin: 0;
    font-size: 16px;
  }

  .state-message {
    margin: 34px 0;
    color: var(--muted-foreground);
    text-align: center;
  }

  .state-message.error {
    color: var(--destructive);
  }

  .settings-list {
    display: grid;
    gap: 10px;
    margin: 20px 0 0;
  }

  .settings-list div {
    display: grid;
    grid-template-columns: minmax(180px, 0.45fr) minmax(0, 1fr);
    gap: 20px;
    padding: 13px 14px;
    border-radius: 9px;
    background: var(--muted);
  }

  dt {
    font-weight: 650;
  }

  dd {
    min-width: 0;
    margin: 0;
    overflow-wrap: anywhere;
    color: var(--muted-foreground);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 13px;
  }
</style>
