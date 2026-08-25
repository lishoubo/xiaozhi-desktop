<script lang="ts">
  import type { EmployeeIdentity } from '@hotel-butler/api';
  import { onDestroy } from 'svelte';
  import { enter, PAGE_ENTER_OPTIONS } from '../motion';
  import { EXPERIENCE_PHONE } from '../auth';
  import LoginBrandPanel from '../components/auth/LoginBrandPanel.svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import { dismissAppNotification, showAppNotification } from '../notifications';

  let { onLogin }: { onLogin: (employee: EmployeeIdentity) => void | Promise<void> } = $props();

  let phone = $state('');
  let code = $state('');
  let agreed = $state(false);
  let codeExpiresAt = $state(0);
  let now = $state(Date.now());
  let policy = $state<'agreement' | 'privacy' | null>(null);
  let policyOpen = $state(false);
  let requestingCode = $state(false);
  let loggingIn = $state(false);
  let remainingSeconds = $derived(Math.max(0, Math.ceil((codeExpiresAt - now) / 1000)));
  const timer = window.setInterval(() => {
    now = Date.now();
  }, 1000);

  onDestroy(() => window.clearInterval(timer));

  function openPolicy(nextPolicy: 'agreement' | 'privacy'): void {
    policy = nextPolicy;
    policyOpen = true;
  }

  async function requestCode(): Promise<void> {
    if (!/^1\d{10}$/.test(phone)) {
      showLoginError('请输入正确的 11 位手机号');
      return;
    }
    dismissAppNotification('login-error');
    requestingCode = true;
    try {
      const result = await window.hotelButler.auth.requestPhoneCode(phone);
      codeExpiresAt = Date.now() + result.expiresInSeconds * 1000;
      now = Date.now();
    } catch {
      showLoginError('验证码发送失败，请重试');
    } finally {
      requestingCode = false;
    }
  }

  async function submit(): Promise<void> {
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
    if (!agreed) {
      showLoginError('请先阅读并同意用户协议与隐私政策');
      return;
    }
    dismissAppNotification('login-error');
    loggingIn = true;
    try {
      const employee = await window.hotelButler.auth.loginWithPhoneCode(phone, code);
      await onLogin(employee);
    } catch {
      showLoginError('登录失败，请检查手机号和验证码');
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
  class="grid h-full grid-rows-[54px_minmax(0,1fr)] overflow-hidden bg-[radial-gradient(circle_at_43%_56%,rgba(64,219,207,.1),transparent_29%),linear-gradient(122deg,#fbfdfe_0%,#f4fbfc_48%,#f8fcfd_100%)]"
  data-motion="page"
  in:enter={PAGE_ENTER_OPTIONS}
>
  <header
    class="flex items-center justify-center border-b border-[#c6cfd7]/70 bg-[#f8f9fa]/90 text-[14px] font-medium tracking-[0.08em] text-[#768292] backdrop-blur-xl"
  >
    小智管家
  </header>
  <div
    class="grid min-h-0 grid-cols-[minmax(0,62%)_minmax(420px,38%)] max-[1040px]:grid-cols-[48%_52%]"
  >
    <LoginBrandPanel />
    <section
      class="relative grid place-items-center overflow-y-auto px-[clamp(28px,4vw,68px)] py-10"
      aria-label="登录区域"
    >
      <form
        class="relative z-10 w-full max-w-[500px] rounded-[18px] border border-white/90 bg-white/95 px-[clamp(32px,4vw,50px)] py-9 shadow-[0_18px_46px_rgba(60,95,112,.13),0_2px_10px_rgba(76,113,130,.05)] backdrop-blur-xl"
        onsubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <h2
          class="mb-8 border-b border-[#e0e5ea] pb-5 text-center text-[17px] font-semibold text-[#0c9f9d]"
        >
          手机验证码登录
        </h2>
        <label class="mb-5 block text-sm font-medium">
          手机号
          <input
            class="mt-2 h-[52px] w-full rounded-[10px] border border-[#d8dfe6] bg-white px-4 text-sm outline-none transition-[border-color,box-shadow] focus:border-[#14a7a5] focus:ring-3 focus:ring-[#14a7a5]/10"
            placeholder="请输入手机号"
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
              class="h-[52px] min-w-0 rounded-[10px] border border-[#d8dfe6] bg-white px-4 text-sm outline-none transition-[border-color,box-shadow] focus:border-[#14a7a5] focus:ring-3 focus:ring-[#14a7a5]/10"
              placeholder="请输入验证码"
              aria-label="验证码"
              autocomplete="one-time-code"
              inputmode="numeric"
              maxlength="6"
              bind:value={code}
            />
            <button
              class={[
                'rounded-[10px] border border-[#d8dfe6] bg-white px-4 font-medium text-[#11a19f] transition-colors hover:border-[#8bd4d1] hover:bg-[#f1fbfa] disabled:bg-[#f7f8f9] disabled:text-[#b8c0c8]',
                remainingSeconds > 0 ? 'text-[11px]' : 'text-sm',
              ]}
              type="button"
              disabled={remainingSeconds > 0 || requestingCode}
              onclick={() => void requestCode()}
            >
              {requestingCode
                ? '正在发送…'
                : remainingSeconds > 0
                  ? `${remainingSeconds} 秒后重新获取`
                  : '获取验证码'}
            </button>
          </div>
        </label>

        <label class="flex items-start gap-2.5 text-sm leading-5 text-muted-foreground">
          <input
            class="mt-1 accent-[#00b48a]"
            type="checkbox"
            bind:checked={agreed}
            aria-label="我已阅读并同意用户协议与隐私政策"
          />
          <span>
            我已阅读并同意
            <button
              class="text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
              type="button"
              onclick={() => openPolicy('agreement')}>《用户协议》</button
            >
            和
            <button
              class="text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
              type="button"
              onclick={() => openPolicy('privacy')}>《隐私政策》</button
            >
          </span>
        </label>

        <button
          class="mt-7 h-[56px] w-full rounded-[11px] bg-[linear-gradient(112deg,#45cec8,#20b6b2)] text-[17px] font-semibold tracking-[0.08em] text-white shadow-[0_10px_22px_rgba(27,177,173,.2)] transition-[filter,transform,box-shadow] hover:brightness-105 disabled:opacity-55"
          type="submit"
          disabled={loggingIn}
        >
          {loggingIn ? '正在登录…' : '登录'}
        </button>
        <p class="mt-4 text-center text-xs text-muted-foreground">
          体验账号：{EXPERIENCE_PHONE}，临时阶段任意 6 位验证码
        </p>
      </form>
    </section>
  </div>
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
            我们遵循合法、正当、必要和诚信原则处理个人信息。登录时，手机号和验证码会发送至小智酒店管家服务端，用于校验您是否为有效的
            RMS 员工；应用偏好及您主动导入的第三方 Cookie 保存在本机。
          </p>
          <p>
            手机号用于识别登录账号；应用登录会话使用服务端可撤销的安全
            Cookie，并存储在客户端独立、加密的浏览器会话中。第三方平台 Cookie
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
