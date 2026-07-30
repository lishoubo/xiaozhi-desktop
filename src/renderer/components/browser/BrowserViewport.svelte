<section class="browser-viewport" data-browser-viewport>
  <div>
    <span class="status">Svelte renderer 已连接</span>
    <h1>浏览器区域</h1>
    <p>下一步将在这里接入由 Electron 主进程管理的 WebContentsView。</p>
  </div>
</section>

<style>
  .browser-viewport {
    display: grid;
    place-items: center;
    min-height: 0;
    padding: 32px;
    text-align: center;
    background: radial-gradient(circle at top, rgb(85 120 238 / 9%), transparent 35%), #f5f7fb;
  }

  .browser-viewport > div {
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
