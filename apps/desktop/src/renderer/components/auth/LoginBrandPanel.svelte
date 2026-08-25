<script lang="ts">
  import ChartNoAxesCombined from '@lucide/svelte/icons/chart-no-axes-combined';
  import MessageCircleCheck from '@lucide/svelte/icons/message-circle-check';
  import ShieldCheck from '@lucide/svelte/icons/shield-check';
  import heroUrl from '../../assets/xiaozhi-hero.png';
  import logoUrl from '../../assets/xiaozhi-logo-3d.png';
</script>

<section
  class="relative min-h-0 overflow-hidden px-[clamp(42px,6vw,96px)] py-[clamp(48px,8vh,88px)]"
  aria-label="小智管家"
>
  <div class="relative z-10 flex items-center gap-4">
    <img
      class="h-[86px] w-[78px] object-contain drop-shadow-[0_12px_18px_rgba(14,177,175,.14)]"
      src={logoUrl}
      alt="小智管家 Logo"
    />
    <div>
      <h1
        class="m-0 text-[clamp(30px,3vw,42px)] leading-none font-semibold tracking-[0.02em] text-[#1f2b38]"
      >
        小智管家
      </h1>
      <p class="mt-3 mb-0 text-[clamp(14px,1.3vw,18px)] tracking-[0.08em] text-[#667283]">
        酒店智能运营 Agent
      </p>
    </div>
  </div>

  <div class="relative z-10 mt-[clamp(44px,7vh,72px)] grid gap-6">
    <div class="flex items-center gap-4">
      <span
        class="grid size-13 shrink-0 place-items-center rounded-full bg-[#e4f7f5] text-[#0aa39d]"
        ><ChartNoAxesCombined size={23} strokeWidth={1.7} /></span
      >
      <div>
        <h2 class="m-0 text-[16px] font-semibold text-[#293645]">智能经营分析</h2>
        <p class="mt-1.5 mb-0 text-[13px] text-[#8b97a7]">多维数据洞察，辅助经营决策</p>
      </div>
    </div>
    <div class="flex items-center gap-4">
      <span
        class="grid size-13 shrink-0 place-items-center rounded-full bg-[#e4f7f5] text-[#0aa39d]"
        ><MessageCircleCheck size={23} strokeWidth={1.7} /></span
      >
      <div>
        <h2 class="m-0 text-[16px] font-semibold text-[#293645]">自动化任务处理</h2>
        <p class="mt-1.5 mb-0 text-[13px] text-[#8b97a7]">覆盖运营全流程，提升执行效率</p>
      </div>
    </div>
    <div class="flex items-center gap-4">
      <span
        class="grid size-13 shrink-0 place-items-center rounded-full bg-[#e4f7f5] text-[#0aa39d]"
        ><ShieldCheck size={23} strokeWidth={1.7} /></span
      >
      <div>
        <h2 class="m-0 text-[16px] font-semibold text-[#293645]">安全可靠保障</h2>
        <p class="mt-1.5 mb-0 text-[13px] text-[#8b97a7]">企业级数据安全，守护信息隐私</p>
      </div>
    </div>
  </div>

  <div class="pointer-events-none absolute top-[11%] left-[28%] h-[78%] w-[76%]" aria-hidden="true">
    <div
      class="absolute inset-[18%] rounded-full bg-[radial-gradient(circle,rgba(67,226,213,.2),rgba(119,230,221,.04)_50%,transparent_72%)] blur-xl"
    ></div>
    <img
      class="relative size-full object-contain drop-shadow-[0_26px_32px_rgba(31,170,166,.12)] motion-safe:animate-[login-float_5.4s_ease-in-out_infinite]"
      src={heroUrl}
      alt=""
      data-login-hero
    />
  </div>
</section>

<style>
  @keyframes login-float {
    0%,
    100% {
      transform: translateY(0);
    }
    50% {
      transform: translateY(-8px);
    }
  }
</style>
