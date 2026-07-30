<script lang="ts">
  import { link } from 'svelte-spa-router';
</script>

<main class="not-found">
  <p>404</p>
  <h1>页面不存在</h1>
  <a href="/" use:link>返回浏览器</a>
</main>

<style>
  .not-found {
    display: grid;
    height: 100%;
    place-content: center;
    justify-items: center;
    text-align: center;
  }

  p {
    margin: 0;
    color: #5578ee;
    font-weight: 750;
  }

  h1 {
    margin: 8px 0 18px;
  }

  a {
    color: #3557cb;
    font-weight: 650;
  }
</style>
