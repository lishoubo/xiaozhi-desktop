<script lang="ts">
  import LogOut from '@lucide/svelte/icons/log-out';
  import UserRound from '@lucide/svelte/icons/user-round';
  import { displayName, readStaffSession } from '../staff-auth';
  import { enter, PAGE_ENTER_OPTIONS } from '../motion';
  import { Button } from '$lib/components/ui/button';

  const session = readStaffSession();
</script>

<main
  class="h-full overflow-auto bg-muted/40 px-9 py-10"
  data-motion="page"
  in:enter={PAGE_ENTER_OPTIONS}
>
  <div class="mx-auto max-w-3xl">
    <h1 class="m-0 text-[28px] font-semibold tracking-[-0.02em]">用户中心</h1>

    <section
      class="mt-6 rounded-lg border border-border bg-card p-6 shadow-[0_1px_3px_rgba(10,10,10,0.04)]"
    >
      <div class="flex items-center gap-4">
        <div class="grid size-11 place-items-center rounded-lg bg-accent text-accent-foreground">
          <UserRound size={21} strokeWidth={1.8} />
        </div>
        <div>
          <p class="m-0 text-sm font-semibold">{session ? displayName(session) : '未登录'}</p>
          <p class="mt-1 mb-0 text-xs text-muted-foreground">
            {session ? `登录账号 ${session.username}` : '当前登录账号'}
          </p>
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
