<script lang="ts">
  let address = 'https://example.com';
</script>

<main class="app-shell">
  <header class="toolbar">
    <div class="window-title">Hotel Butler</div>

    <nav class="navigation" aria-label="浏览器控制">
      <button type="button" aria-label="后退" disabled>←</button>
      <button type="button" aria-label="前进" disabled>→</button>
      <button type="button" aria-label="刷新" disabled>↻</button>
    </nav>

    <input
      class="address"
      aria-label="网址"
      bind:value={address}
      spellcheck="false"
    />
  </header>

  <section class="browser-placeholder">
    <div>
      <span class="status">Svelte renderer 已连接</span>
      <h1>浏览器区域</h1>
      <p>下一步将在这里接入由 Electron 主进程管理的 WebContentsView。</p>
    </div>
  </section>
</main>

<style>
  .app-shell {
    display: grid;
    grid-template-rows: 64px 1fr;
    height: 100%;
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 12px 18px;
    background: #ffffff;
    border-bottom: 1px solid #e3e8f0;
  }

  .window-title {
    font-weight: 700;
    white-space: nowrap;
  }

  .navigation {
    display: flex;
    gap: 6px;
  }

  button {
    width: 34px;
    height: 34px;
    border: 1px solid #d7deea;
    border-radius: 8px;
    background: #f8fafc;
    color: #596579;
  }

  .address {
    width: 100%;
    height: 38px;
    padding: 0 14px;
    border: 1px solid #d7deea;
    border-radius: 9px;
    outline: none;
  }

  .address:focus {
    border-color: #5578ee;
    box-shadow: 0 0 0 3px rgb(85 120 238 / 14%);
  }

  .browser-placeholder {
    display: grid;
    place-items: center;
    padding: 32px;
    text-align: center;
    background:
      radial-gradient(circle at top, rgb(85 120 238 / 9%), transparent 35%),
      #f5f7fb;
  }

  .browser-placeholder div {
    max-width: 500px;
  }

  .status {
    display: inline-block;
    padding: 6px 10px;
    border-radius: 999px;
    color: #3557cb;
    background: #e9eeff;
    font-size: 13px;
    font-weight: 650;
  }

  h1 {
    margin: 18px 0 8px;
    font-size: 28px;
  }

  p {
    margin: 0;
    color: #657086;
    line-height: 1.6;
  }
</style>
