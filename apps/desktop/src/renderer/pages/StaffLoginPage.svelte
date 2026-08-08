<script lang="ts">
  import type { StaffIdentity } from '@hotel-butler/api';
  import { enter, PAGE_ENTER_OPTIONS } from '../motion';
  import AgentAvatar from '../components/agent/AgentAvatar.svelte';
  import { dismissAppNotification, showAppNotification } from '../notifications';

  let { onLogin }: { onLogin: (employee: StaffIdentity) => void | Promise<void> } = $props();

  let username = $state('');
  let password = $state('');
  let loggingIn = $state(false);

  async function submit(): Promise<void> {
    if (username.trim().length === 0) {
      showLoginError('请输入用户名');
      return;
    }
    if (password.length < 6) {
      showLoginError('密码至少 6 位');
      return;
    }
    dismissAppNotification('login-error');
    loggingIn = true;
    try {
      const employee = await window.hotelButler.staffAuth.login(username.trim(), password);
      await onLogin(employee);
    } catch (error) {
      // main 已把远端错误转成可读文案（区分"密码错误"与"账号已锁定"），直接展示。
      showLoginError(error instanceof Error ? error.message : '登录失败，请稍后重试');
    } finally {
      loggingIn = false;
    }
  }

  function showLoginError(message: string): void {
    showAppNotification({
      id: 'login-error',
      title: '无法登录',
      message,
      tone: 'error',
    });
  }
</script>

<main
  class="grid h-full grid-cols-[minmax(420px,0.95fr)_minmax(480px,1.05fr)] bg-background"
  data-motion="page"
  in:enter={PAGE_ENTER_OPTIONS}
>
  <section class="relative overflow-hidden bg-[#0a1530]" aria-label="小智AI 管家">
    <div
      class="absolute -top-20 -left-24 size-80 rounded-full bg-[#5645d4]/20 blur-3xl"
      aria-hidden="true"
    ></div>
    <div
      class="absolute top-20 right-14 size-16 rotate-6 rounded-xl bg-[#f5d75e]/85 shadow-lg"
      aria-hidden="true"
    ></div>
    <div
      class="absolute right-20 bottom-20 size-11 -rotate-6 rounded-lg bg-[#ff64c8]/70 shadow-lg"
      aria-hidden="true"
    ></div>

    <div class="relative z-10 flex h-full flex-col px-12 py-10 text-white">
      <div class="flex items-center gap-3 text-sm font-semibold">
        <span class="grid size-9 place-items-center rounded-lg bg-primary">智</span>
        小智酒店管家
      </div>

      <div class="my-auto max-w-md">
        <div class="flex gap-x-5 items-center">
          <AgentAvatar size="lg" online motion="float" />
          <h1 class="max-w-sm text-4xl leading-[1.18] font-semibold tracking-[-0.03em]">
            小智 AI 酒店管家
          </h1>
        </div>
        <p class="ml-2 mt-3 mb-0 max-w-sm text-sm leading-7 text-white/65">
          酒店渠道管理、运营事项处理，任何事情请和小智聊聊。
        </p>
      </div>

      <p class="m-0 text-xs text-white/45">酒店渠道聚合管理工作台</p>
    </div>
  </section>

  <section
    class="relative grid place-items-center overflow-hidden overflow-y-auto bg-[#fafaf9] px-12 py-10"
    aria-label="登录区域"
  >
    <div
      class="absolute -top-28 -right-24 size-80 rounded-full bg-primary/8 blur-3xl"
      aria-hidden="true"
    ></div>
    <div
      class="absolute -bottom-24 left-8 size-64 rounded-full bg-[#ff64c8]/6 blur-3xl"
      aria-hidden="true"
    ></div>
    <form
      class="relative z-10 w-full max-w-[440px] rounded-2xl border border-border bg-card p-9 shadow-xl"
      onsubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <h2 class="sr-only">登录</h2>
      <label class="mb-5 block text-sm font-medium">
        用户名
        <input
          class="mt-2 h-11 w-full rounded-md border border-input bg-background px-3.5 transition-[border-color,box-shadow] duration-150 ease-out outline-none focus:border-ring focus:ring-3 focus:ring-ring/15 motion-reduce:transition-none"
          aria-label="用户名"
          autocomplete="username"
          maxlength="64"
          bind:value={username}
        />
      </label>

      <label class="mb-5 block text-sm font-medium">
        密码
        <input
          class="mt-2 h-11 w-full rounded-md border border-input bg-background px-3.5 transition-[border-color,box-shadow] duration-150 ease-out outline-none focus:border-ring focus:ring-3 focus:ring-ring/15 motion-reduce:transition-none"
          aria-label="密码"
          type="password"
          autocomplete="current-password"
          maxlength="128"
          bind:value={password}
        />
      </label>

      <button
        class="mt-6 h-11 w-full rounded-md bg-primary text-sm font-medium text-primary-foreground transition-colors duration-150 ease-out hover:bg-[#4534b3] motion-reduce:transition-none"
        type="submit"
        disabled={loggingIn}
      >
        {loggingIn ? '正在登录…' : '登录'}
      </button>
      <p class="mt-4 text-center text-xs text-muted-foreground">
        请使用您的员工账号登录，忘记密码请联系管理员
      </p>
    </form>
  </section>
</main>
