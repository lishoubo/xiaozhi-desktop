<script lang="ts">
  import { QueryClientProvider } from '@tanstack/svelte-query';
  import Router from 'svelte-spa-router';
  import { onDestroy } from 'svelte';
  import AppFrame from './components/layout/AppFrame.svelte';
  import LoginPage from './pages/LoginPage.svelte';
  import { clearAuthSession, createAuthSession, readAuthSession, type AuthSession } from './auth';
  import { queryClient } from './query-client';
  import { routes } from './routes';

  let session = $state<AuthSession | null>(readAuthSession());
  const sessionTimer = window.setInterval(() => {
    if (session && !readAuthSession()) session = null;
  }, 60_000);
  const logout = (): void => {
    clearAuthSession();
    session = null;
  };
  window.addEventListener('hotel-butler:logout', logout);
  onDestroy(() => {
    window.clearInterval(sessionTimer);
    window.removeEventListener('hotel-butler:logout', logout);
  });
</script>

{#if session}
  <QueryClientProvider client={queryClient}>
    <AppFrame phone={session.phone}>
      <Router {routes} />
    </AppFrame>
  </QueryClientProvider>
{:else}
  <LoginPage onLogin={(phone) => (session = createAuthSession(phone))} />
{/if}
