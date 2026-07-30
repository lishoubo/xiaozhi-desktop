import { queryOptions } from '@tanstack/svelte-query';

export const settingsQueryKeys = {
  all: ['settings'] as const,
};

export function settingsListQueryOptions() {
  return queryOptions({
    queryKey: settingsQueryKeys.all,
    queryFn: () => window.hotelButler.settings.list(),
  });
}
