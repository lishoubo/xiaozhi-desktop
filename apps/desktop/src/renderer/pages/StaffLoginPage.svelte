<script lang="ts">
  import type { StaffIdentity } from '@hotel-butler/api';
  import { onDestroy } from 'svelte';
  import { enter, PAGE_ENTER_OPTIONS } from '../motion';
  import AgentAvatar from '../components/agent/AgentAvatar.svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import { dismissAppNotification, showAppNotification } from '../notifications';

  let { onLogin }: { onLogin: (employee: StaffIdentity) => void | Promise<void> } = $props();

  /**
   * 两类用户共用这一个页面，运行时切换而非构建期二选一：同一个安装包既要给酒店用户
   * 用（手机号+验证码），也要给服务商员工用（用户名+密码）。两条路都走 `staffAuth`
   * 通道、产出同一个 `StaffIdentity`，所以登录之后的一切完全一致。
   */
  let userType = $state<'hotel' | 'staff'>('hotel');

  let phone = $state('');
  let code = $state('');
  let agreed = $state(false);
  let username = $state('');
  let password = $state('');

  /**
   * 两个时长来自服务端且**含义不同，不能混用**：
   * - `resendAfterSeconds`（60s）→ 「重新获取」按钮何时可再点
   * - `expiresInSeconds`（300s）→ 验证码本身何时失效
   * 用一个值同时驱动两者，会把 60s 的重发间隔算成 300s。
   */
  let resendAvailableAt = $state(0);
  let codeExpiresAt = $state(0);
  let now = $state(Date.now());

  let policy = $state<'agreement' | 'privacy' | null>(null);
  let policyOpen = $state(false);
  let requestingCode = $state(false);
  let loggingIn = $state(false);

  let resendSeconds = $derived(Math.max(0, Math.ceil((resendAvailableAt - now) / 1000)));
  let codeExpired = $derived(codeExpiresAt > 0 && codeExpiresAt <= now);

  const timer = window.setInterval(() => {
    now = Date.now();
  }, 1000);

  onDestroy(() => window.clearInterval(timer));

  function openPolicy(nextPolicy: 'agreement' | 'privacy'): void {
    policy = nextPolicy;
    policyOpen = true;
  }

  /** 切换只改本地状态：不发请求，也不碰已保存的登录态。 */
  function switchTo(next: 'hotel' | 'staff'): void {
    if (userType === next) return;
    userType = next;
    dismissAppNotification('login-error');
  }

  async function requestCode(): Promise<void> {
    if (!/^1\d{10}$/.test(phone)) {
      showLoginError('请输入正确的 11 位手机号');
      return;
    }
    dismissAppNotification('login-error');
    requestingCode = true;
    try {
      const result = await window.hotelButler.staffAuth.requestPhoneCode(phone);
      now = Date.now();
      resendAvailableAt = now + result.resendAfterSeconds * 1000;
      codeExpiresAt = now + result.expiresInSeconds * 1000;
    } catch (error) {
      // main 已按错误码给出可读文案（区分"发送过频"与"手机号不可用"），直接展示。
      showLoginError(error instanceof Error ? error.message : '验证码发送失败，请稍后再试');
    } finally {
      requestingCode = false;
    }
  }

  async function submitPhone(): Promise<void> {
    if (!/^1\d{10}$/.test(phone)) {
      showLoginError('请输入正确的 11 位手机号');
      return;
    }
    if (!/^\d{6}$/.test(code)) {
      showLoginError('验证码应为 6 位数字');
      return;
    }
    if (codeExpiresAt === 0) {
      showLoginError('请先获取验证码');
      return;
    }
    if (codeExpired) {
      showLoginError('验证码已过期，请重新获取');
      return;
    }
    if (!agreed) {
      showLoginError('请先阅读并同意用户协议与隐私政策');
      return;
    }
    await runLogin(() => window.hotelButler.staffAuth.loginWithPhoneCode(phone, code));
  }

  async function submitPassword(): Promise<void> {
    if (username.trim().length === 0) {
      showLoginError('请输入用户名');
      return;
    }
    if (password.length < 6) {
      showLoginError('密码至少 6 位');
      return;
    }
    await runLogin(() => window.hotelButler.staffAuth.login(username.trim(), password));
  }

  async function runLogin(login: () => Promise<StaffIdentity>): Promise<void> {
    dismissAppNotification('login-error');
    loggingIn = true;
    try {
      await onLogin(await login());
    } catch (error) {
      // main 已把远端错误转成可读文案（区分"验证码错误"与"错误次数过多"），直接展示。
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
        void (userType === 'hotel' ? submitPhone() : submitPassword());
      }}
    >
      <h2 class="sr-only">登录</h2>

      <div class="mb-6 flex justify-end" role="tablist" aria-label="选择用户类型">
        <div class="inline-flex rounded-lg border border-border bg-muted/60 p-0.5 text-xs">
          <button
            class={[
              'rounded-md px-3 py-1.5 font-medium transition-colors duration-150 ease-out motion-reduce:transition-none',
              userType === 'hotel'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            ]}
            type="button"
            role="tab"
            aria-selected={userType === 'hotel'}
            onclick={() => switchTo('hotel')}
          >
            酒店用户
          </button>
          <button
            class={[
              'rounded-md px-3 py-1.5 font-medium transition-colors duration-150 ease-out motion-reduce:transition-none',
              userType === 'staff'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            ]}
            type="button"
            role="tab"
            aria-selected={userType === 'staff'}
            onclick={() => switchTo('staff')}
          >
            服务商用户
          </button>
        </div>
      </div>

      {#if userType === 'hotel'}
        <label class="mb-5 block text-sm font-medium">
          手机号
          <input
            class="mt-2 h-11 w-full rounded-md border border-input bg-background px-3.5 transition-[border-color,box-shadow] duration-150 ease-out outline-none focus:border-ring focus:ring-3 focus:ring-ring/15 motion-reduce:transition-none"
            aria-label="手机号"
            autocomplete="tel"
            inputmode="numeric"
            maxlength="11"
            bind:value={phone}
          />
        </label>

        <label class="mb-5 block text-sm font-medium">
          验证码
          <div class="mt-2 grid grid-cols-[minmax(0,1fr)_128px] gap-2">
            <input
              class="h-11 min-w-0 rounded-md border border-input bg-background px-3.5 transition-[border-color,box-shadow] duration-150 ease-out outline-none focus:border-ring focus:ring-3 focus:ring-ring/15 motion-reduce:transition-none"
              aria-label="验证码"
              autocomplete="one-time-code"
              inputmode="numeric"
              maxlength="6"
              bind:value={code}
            />
            <button
              class="rounded-md border border-input bg-background px-3 text-sm font-medium whitespace-nowrap transition-colors duration-150 ease-out hover:bg-muted motion-reduce:transition-none disabled:text-muted-foreground"
              type="button"
              disabled={resendSeconds > 0 || requestingCode}
              onclick={() => void requestCode()}
            >
              {requestingCode
                ? '发送中…'
                : resendSeconds > 0
                  ? `${resendSeconds}s 后重发`
                  : '获取验证码'}
            </button>
          </div>
          {#if codeExpired}
            <span class="mt-2 block text-xs font-normal text-destructive">
              验证码已过期，请重新获取
            </span>
          {/if}
        </label>

        <label class="flex items-start gap-2.5 text-sm leading-5 text-muted-foreground">
          <input
            class="mt-1 accent-primary"
            type="checkbox"
            bind:checked={agreed}
            aria-label="我已阅读并同意用户协议与隐私政策"
          />
          <span>
            我已阅读并同意
            <button
              class="text-primary hover:underline"
              type="button"
              onclick={() => openPolicy('agreement')}>《用户协议》</button
            >
            和
            <button
              class="text-primary hover:underline"
              type="button"
              onclick={() => openPolicy('privacy')}>《隐私政策》</button
            >
          </span>
        </label>
      {:else}
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
      {/if}

      <button
        class="mt-6 h-11 w-full rounded-md bg-primary text-sm font-medium text-primary-foreground transition-colors duration-150 ease-out hover:bg-[#4534b3] motion-reduce:transition-none"
        type="submit"
        disabled={loggingIn}
      >
        {loggingIn ? '正在登录…' : '登录'}
      </button>
      <p class="mt-4 text-center text-xs text-muted-foreground">
        {userType === 'hotel'
          ? '未注册的手机号首次登录将自动创建账号'
          : '请使用您的员工账号登录，忘记密码请联系管理员'}
      </p>
    </form>
  </section>
</main>

{#if policy}
  <Dialog.Root bind:open={policyOpen}>
    <Dialog.Content class="max-h-[78vh] overflow-auto sm:max-w-2xl">
      <Dialog.Header>
        <Dialog.Title>
          {policy === 'agreement' ? '小智酒店管家用户协议' : '小智酒店管家隐私政策'}
        </Dialog.Title>
      </Dialog.Header>
      {#if policy === 'agreement'}
        <div class="space-y-4 text-sm leading-7 text-secondary-foreground">
          <p>
            本协议适用于您使用小智酒店管家
            酒店渠道聚合管理客户端。您应使用本人或经合法授权的账号登录，并妥善保管验证码、平台凭证及经营数据。
          </p>
          <p>
            本客户端仅提供第三方 OTA/PMS
            平台的聚合访问能力。第三方页面、交易、订单及服务由相应平台负责，您仍须遵守各平台规则。禁止利用本客户端实施未授权访问、数据抓取、欺诈或其他违法行为。
          </p>
          <p>
            Cookie
            导入仅在您主动选择本机浏览器并授权后执行。您应确认对其中账号数据拥有合法使用权。因第三方平台调整、网络故障或不可抗力导致的暂时不可用，我们将在合理范围内协助恢复。
          </p>
          <p>
            您可随时在用户中心退出登录并清除本机登录状态。协议更新涉及重大权益时，我们会重新征得您的同意。
          </p>
        </div>
      {:else}
        <div class="space-y-4 text-sm leading-7 text-secondary-foreground">
          <p>
            我们遵循合法、正当、必要和诚信原则处理个人信息。登录时，手机号和验证码会发送至小智酒店管家服务端用于校验；应用偏好及您主动导入的第三方
            Cookie 保存在本机。
          </p>
          <p>
            手机号用于识别登录账号；登录凭证在本机加密存储，仅在向服务端发起请求时携带。第三方平台
            Cookie
            仅在对应网站请求时自动携带。您可通过退出登录清除应用登录状态，并可在系统数据目录中清理客户端数据。
          </p>
          <p>
            客户端不会在未经操作时读取其他浏览器的 Cookie
            数据。只有在您选择指定浏览器并开始导入后，客户端才会在本机读取受支持 OTA 平台相关域名的
            Cookie；数据不会上传至我们的服务器。请避免在公共设备保存敏感凭证。
          </p>
          <p>
            如处理目的、范围或共享对象发生变化，我们会更新本政策并依法另行告知或取得同意。您可通过产品支持渠道提出查阅、更正、删除或撤回同意的请求。
          </p>
        </div>
      {/if}
    </Dialog.Content>
  </Dialog.Root>
{/if}
