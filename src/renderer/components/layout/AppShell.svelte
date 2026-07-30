<script lang="ts">
  import BrowserToolbar from '../browser/BrowserToolbar.svelte';
  import BrowserViewport from '../browser/BrowserViewport.svelte';
</script>

<main class="app-shell">
  <BrowserToolbar />
  <BrowserViewport />
</main>

<style>
  .app-shell {
    display: grid;
    grid-template-rows: 64px minmax(0, 1fr);
    height: 100%;
    min-height: 0;
  }
</style>
