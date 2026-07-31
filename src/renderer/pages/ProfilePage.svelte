<script lang="ts">
  import LogOut from '@lucide/svelte/icons/log-out';
  import UserRound from '@lucide/svelte/icons/user-round';
  import { maskPhone, readAuthSession } from '../auth';
  import { Button } from '$lib/components/ui/button';

  const session = readAuthSession();
</script>

<main class="h-full overflow-auto bg-secondary px-9 py-10">
  <div class="mx-auto max-w-3xl">
    <h1 class="m-0 text-[28px] font-semibold tracking-[-0.02em]">用户中心</h1>

    <section class="mt-6 rounded-lg border border-border bg-card">
      <div class="flex items-center gap-4 border-b border-border p-6">
        <div class="grid size-11 place-items-center rounded-lg bg-accent text-accent-foreground">
          <UserRound size={21} strokeWidth={1.8} />
        </div>
        <div>
          <p class="m-0 text-sm font-semibold">{session ? maskPhone(session.phone) : '未登录'}</p>
          <p class="mt-1 mb-0 text-xs text-muted-foreground">当前登录账号</p>
        </div>
      </div>

      <dl class="m-0 divide-y divide-border">
        <div class="grid grid-cols-[160px_minmax(0,1fr)_auto] items-center gap-4 px-6 py-4">
          <dt class="text-sm font-medium">手机号</dt>
          <dd class="m-0 text-sm text-muted-foreground">{session?.phone ?? '—'}</dd>
          <Button variant="outline" size="sm" disabled>修改</Button>
        </div>
        <div class="grid grid-cols-[160px_minmax(0,1fr)_auto] items-center gap-4 px-6 py-4">
          <dt class="text-sm font-medium">注销账号</dt>
          <dd class="m-0 text-sm text-muted-foreground">后端服务接入后开放</dd>
          <Button variant="outline" size="sm" disabled>注销</Button>
        </div>
      </dl>
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
