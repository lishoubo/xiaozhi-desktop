<script lang="ts">
  import LogOut from '@lucide/svelte/icons/log-out';
  import UserRound from '@lucide/svelte/icons/user-round';
  import { maskPhone, readAuthSession } from '../auth';
  import { enter, PAGE_ENTER_OPTIONS } from '../motion';
  import { Button } from '$lib/components/ui/button';

  const session = readAuthSession();
</script>

<main
  class="h-full overflow-auto bg-[#f8fafb] px-9 py-9"
  data-motion="page"
  in:enter={PAGE_ENTER_OPTIONS}
>
  <div class="mx-auto max-w-3xl">
    <h1 class="m-0 text-[28px] font-semibold tracking-[-0.02em]">用户中心</h1>

    <section
      class="mt-6 rounded-[12px] border border-border bg-card p-6 shadow-[var(--shadow-card)]"
    >
      <div class="flex items-center gap-4">
        <div class="grid size-11 place-items-center rounded-lg bg-accent text-accent-foreground">
          <UserRound size={21} strokeWidth={1.8} />
        </div>
        <div>
          <p class="m-0 text-sm font-semibold">{session ? maskPhone(session.phone) : '未登录'}</p>
          <p class="mt-1 mb-0 text-xs text-muted-foreground">当前登录账号</p>
        </div>
      </div>
    </section>

    <Button
      class="mt-6"
      variant="outline"
      onclick={() => window.dispatchEvent(new Event('hotel-butler:logout'))}
    >
      <LogOut size={16} strokeWidth={1.8} />
      退出登录
    </Button>
  </div>
</main>
