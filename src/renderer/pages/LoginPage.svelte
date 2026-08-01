<script lang="ts">
  import { onDestroy } from 'svelte';
  import ShieldCheck from '@lucide/svelte/icons/shield-check';
  import { CODE_DURATION_MS, MOCK_CODE, MOCK_PHONE } from '../auth';

  let { onLogin }: { onLogin: (phone: string) => void } = $props();

  let phone = $state('');
  let code = $state('');
  let agreed = $state(false);
  let error = $state('');
  let codeExpiresAt = $state(0);
  let now = $state(Date.now());
  let policy = $state<'agreement' | 'privacy' | null>(null);
  let remainingSeconds = $derived(Math.max(0, Math.ceil((codeExpiresAt - now) / 1000)));
  const timer = window.setInterval(() => {
    now = Date.now();
  }, 1000);

  onDestroy(() => window.clearInterval(timer));

  function requestCode(): void {
    if (!/^1\d{10}$/.test(phone)) {
      error = '请输入正确的 11 位手机号';
      return;
    }
    error = '';
    codeExpiresAt = Date.now() + CODE_DURATION_MS;
    now = Date.now();
  }

  function submit(): void {
    if (!/^1\d{10}$/.test(phone)) {
      error = '请输入正确的 11 位手机号';
      return;
    }
    if (!/^\d{6}$/.test(code)) {
      error = '验证码应为 6 位数字';
      return;
    }
    if (codeExpiresAt === 0 || codeExpiresAt <= Date.now()) {
      error = '验证码已过期，请重新获取';
      return;
    }
    if (phone !== MOCK_PHONE || code !== MOCK_CODE) {
      error = '手机号或验证码不正确';
      return;
    }
    if (!agreed) {
      error = '请先阅读并同意用户协议与隐私政策';
      return;
    }
    error = '';
    onLogin(phone);
  }
</script>

<main class="grid h-full grid-cols-[minmax(320px,0.92fr)_minmax(440px,1.08fr)] bg-background">
  <section class="relative overflow-hidden bg-[#0a1530]" aria-label="品牌图片区">
    <div class="absolute inset-x-12 bottom-12 text-white">
      <div class="mb-4 grid size-12 place-items-center rounded-lg bg-primary font-semibold">HB</div>
      <h1 class="m-0 text-3xl font-semibold tracking-[-0.02em]">Hotel Butler</h1>
      <p class="mt-3 text-sm text-white/65">酒店渠道聚合管理工作台</p>
    </div>
  </section>

  <section class="grid place-items-center px-12">
    <form
      class="w-full max-w-[390px]"
      onsubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <ShieldCheck class="mb-7 text-primary" size={28} strokeWidth={1.8} />
      <h2 class="m-0 text-[28px] font-semibold tracking-[-0.02em]">登录</h2>
      <p class="mt-2 mb-8 text-sm text-muted-foreground">使用手机号验证身份</p>

      <label class="mb-5 block text-sm font-medium">
        手机号
        <input
          class="mt-2 h-11 w-full rounded-md border border-input bg-background px-3.5 outline-none focus:border-ring focus:ring-3 focus:ring-ring/15"
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
            class="h-11 min-w-0 rounded-md border border-input bg-background px-3.5 outline-none focus:border-ring focus:ring-3 focus:ring-ring/15"
            aria-label="验证码"
            autocomplete="one-time-code"
            inputmode="numeric"
            maxlength="6"
            bind:value={code}
          />
          <button
            class="rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-muted disabled:text-muted-foreground"
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
            onclick={() => (policy = 'agreement')}>《用户协议》</button
          >
          和
          <button
            class="text-primary hover:underline"
            type="button"
            onclick={() => (policy = 'privacy')}>《隐私政策》</button
          >
        </span>
      </label>

      {#if error}
        <p class="mt-4 mb-0 text-sm text-destructive" role="alert">{error}</p>
      {/if}

      <button
        class="mt-6 h-11 w-full rounded-md bg-primary text-sm font-medium text-primary-foreground hover:bg-[#4534b3]"
        type="submit"
      >
        登录
      </button>
      <p class="mt-4 text-center text-xs text-muted-foreground">Mock：13800138000 / 123456</p>
    </form>
  </section>
</main>

{#if policy}
  <div class="fixed inset-0 z-50 grid place-items-center bg-black/35 p-8" role="presentation">
    <div
      class="max-h-[78vh] w-full max-w-2xl overflow-auto rounded-lg bg-card p-7 shadow-2xl"
      role="dialog"
      aria-modal="true"
      aria-labelledby="policy-title"
    >
      <div class="flex items-start justify-between gap-6">
        <h2 id="policy-title" class="m-0 text-xl font-semibold">
          {policy === 'agreement' ? 'Hotel Butler 用户协议' : 'Hotel Butler 隐私政策'}
        </h2>
        <button
          class="rounded-md px-3 py-1.5 text-sm hover:bg-muted"
          type="button"
          onclick={() => (policy = null)}>关闭</button
        >
      </div>
      {#if policy === 'agreement'}
        <div class="mt-6 space-y-4 text-sm leading-7 text-secondary-foreground">
          <p>
            本协议适用于您使用 Hotel Butler
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
            您可在用户中心退出登录。账号注销功能将在后端服务就绪后开放。协议更新涉及重大权益时，我们会重新征得您的同意。
          </p>
        </div>
      {:else}
        <div class="mt-6 space-y-4 text-sm leading-7 text-secondary-foreground">
          <p>
            我们遵循合法、正当、必要和诚信原则处理个人信息。当前 Mock
            版本仅在本机保存登录手机号、会话到期时间、应用偏好及您主动导入的
            Cookie，不向我们的服务器上传。
          </p>
          <p>
            手机号用于识别登录账号；会话信息用于维持登录状态；Cookie 存储在 Electron
            的独立持久会话中，仅在对应第三方网站请求时自动携带。您可通过退出登录清除应用登录状态，并可在系统数据目录中清理客户端数据。
          </p>
          <p>
            客户端不会在未经操作时读取其他浏览器的 Cookie
            数据。只有在您选择指定浏览器并开始导入后，客户端才会在本机读取受支持 OTA 平台相关域名的
            Cookie；数据不会上传至我们的服务器。请避免在公共设备保存敏感凭证。
          </p>
          <p>
            待后端接口接入后，如处理目的、范围或共享对象发生变化，我们会更新本政策并依法另行告知或取得同意。您可通过产品支持渠道提出查阅、更正、删除或撤回同意的请求。
          </p>
        </div>
      {/if}
    </div>
  </div>
{/if}
