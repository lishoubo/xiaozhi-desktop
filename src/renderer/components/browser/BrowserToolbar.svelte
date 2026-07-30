<script lang="ts">
  let address = 'https://example.com';
</script>

<header class="toolbar">
  <div class="window-title">Hotel Butler</div>

  <nav class="navigation" aria-label="浏览器控制">
    <button type="button" aria-label="后退" disabled>←</button>
    <button type="button" aria-label="前进" disabled>→</button>
    <button type="button" aria-label="刷新" disabled>↻</button>
  </nav>

  <input class="address" aria-label="网址" bind:value={address} spellcheck="false" />
</header>

<style>
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
</style>
