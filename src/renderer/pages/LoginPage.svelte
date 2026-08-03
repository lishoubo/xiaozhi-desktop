<script lang="ts">
  import { onDestroy } from 'svelte';
  import { enter, PAGE_ENTER_OPTIONS } from '../motion';
  import { CODE_DURATION_MS, MOCK_CODE, MOCK_PHONE } from '../auth';
  import AgentAvatar from '../components/agent/AgentAvatar.svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import { dismissAppNotification, showAppNotification } from '../notifications';

  let { onLogin }: { onLogin: (phone: string) => void } = $props();

  let phone = $state('');
  let code = $state('');
  let agreed = $state(false);
  let codeExpiresAt = $state(0);
  let now = $state(Date.now());
  let policy = $state<'agreement' | 'privacy' | null>(null);
  let policyOpen = $state(false);
  let remainingSeconds = $derived(Math.max(0, Math.ceil((codeExpiresAt - now) / 1000)));
  const timer = window.setInterval(() => {
    now = Date.now();
  }, 1000);

  onDestroy(() => window.clearInterval(timer));

  function openPolicy(nextPolicy: 'agreement' | 'privacy'): void {
    policy = nextPolicy;
    policyOpen = true;
  }

  function requestCode(): void {
    if (!/^1\d{10}$/.test(phone)) {
      showLoginError('请输入正确的 11 位手机号');
      return;
    }
    dismissAppNotification('login-error');
    codeExpiresAt = Date.now() + CODE_DURATION_MS;
    now = Date.now();
  }

  function submit(): void {
    if (!/^1\d{10}$/.test(phone)) {
      showLoginError('请输入正确的 11 位手机号');
      return;
    }
    if (!/^\d{6}$/.test(code)) {
      showLoginError('验证码应为 6 位数字');
      return;
    }
    if (codeExpiresAt === 0 || codeExpiresAt <= Date.now()) {
      showLoginError('验证码已过期，请重新获取');
      return;
    }
    if (phone !== MOCK_PHONE || code !== MOCK_CODE) {
      showLoginError('手机号或验证码不正确');
      return;
    }
    if (!agreed) {
      showLoginError('请先阅读并同意用户协议与隐私政策');
      return;
    }
    dismissAppNotification('login-error');
    onLogin(phone);
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
        submit();
      }}
    >
      <h2 class="sr-only">登录</h2>
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
            class={[
              'rounded-md border border-input bg-background px-3 font-medium transition-colors duration-150 ease-out hover:bg-muted motion-reduce:transition-none disabled:text-muted-foreground',
              remainingSeconds > 0 ? 'text-[11px]' : 'text-sm',
            ]}
            type="button"
            disabled={remainingSeconds > 0}
            onclick={requestCode}
          >
            {remainingSeconds > 0 ? `${remainingSeconds} 秒后重新获取` : '获取验证码'}
          </button>
        </div>
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

      <button
        class="mt-6 h-11 w-full rounded-md bg-primary text-sm font-medium text-primary-foreground transition-colors duration-150 ease-out hover:bg-[#4534b3] motion-reduce:transition-none"
        type="submit"
      >
        登录
      </button>
      <p class="mt-4 text-center text-xs text-muted-foreground">
        体验账号：13800138000，验证码：123456
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
            我们遵循合法、正当、必要和诚信原则处理个人信息。当前版本仅在本机保存登录手机号、会话到期时间、应用偏好及您主动导入的
            Cookie，不向我们的服务器上传。
          </p>
          <p>
            手机号用于识别登录账号；会话信息用于维持登录状态；Cookie
            存储在客户端的独立浏览器会话中，仅在对应第三方网站请求时自动携带。您可通过退出登录清除应用登录状态，并可在系统数据目录中清理客户端数据。
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
