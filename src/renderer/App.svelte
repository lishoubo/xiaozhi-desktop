<script lang="ts">
  import { QueryClientProvider } from '@tanstack/svelte-query';
  import Router from 'svelte-spa-router';
  import AppFrame from './components/layout/AppFrame.svelte';
  import { queryClient } from './query-client';
  import { routes } from './routes';
</script>

<QueryClientProvider client={queryClient}>
  <AppFrame>
    <Router {routes} />
  </AppFrame>
</QueryClientProvider>
