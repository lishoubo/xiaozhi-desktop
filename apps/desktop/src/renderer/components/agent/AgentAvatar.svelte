<script lang="ts">
  import Sparkles from '@lucide/svelte/icons/sparkles';

  let {
    size = 'md',
    online = false,
    motion = 'static',
  }: {
    size?: 'sm' | 'md' | 'lg' | 'xl';
    online?: boolean;
    motion?: 'static' | 'float';
  } = $props();

  const sizeClasses = {
    sm: 'size-8 rounded-lg',
    md: 'size-9 rounded-lg',
    lg: 'size-14 rounded-xl',
    xl: 'size-20 rounded-2xl',
  } as const;

  const iconSizes = {
    sm: 17,
    md: 19,
    lg: 26,
    xl: 36,
  } as const;
</script>

<span
  data-agent-avatar
  data-motion={motion}
  class={[
    'agent-avatar relative grid shrink-0 place-items-center bg-accent text-accent-foreground shadow-sm transition-[transform,box-shadow] duration-150 ease-out group-hover/agent:-translate-y-0.5 group-hover/agent:shadow-md motion-reduce:transform-none motion-reduce:transition-none',
    sizeClasses[size],
  ]}
  aria-hidden="true"
>
  <span class="agent-sparkle grid place-items-center">
    <Sparkles size={iconSizes[size]} strokeWidth={1.9} />
  </span>
  {#if online}
    <span
      data-agent-status="breathing"
      class="agent-status absolute right-0 bottom-0 size-2.5 rounded-full bg-[#1aae39] ring-2 ring-background"
    ></span>
  {/if}
</span>

<style>
  .agent-avatar[data-motion='float'] {
    animation: agent-float 3.8s ease-in-out infinite;
  }

  .agent-avatar[data-motion='float'] .agent-sparkle {
    transform-origin: center;
    animation: agent-sparkle 3.8s ease-in-out infinite;
  }

  .agent-status::after {
    position: absolute;
    inset: -4px;
    border-radius: 9999px;
    background: rgb(26 174 57 / 32%);
    content: '';
    animation: agent-status-breathe 2.4s ease-out infinite;
  }

  @keyframes agent-float {
    0%,
    100% {
      transform: translate3d(0, 0, 0);
    }
    50% {
      transform: translate3d(0, -4px, 0);
    }
  }

  @keyframes agent-sparkle {
    0%,
    100% {
      transform: rotate(-2deg) scale(0.98);
    }
    50% {
      transform: rotate(2deg) scale(1.06);
    }
  }

  @keyframes agent-status-breathe {
    0% {
      opacity: 0.7;
      transform: scale(0.75);
    }
    72%,
    100% {
      opacity: 0;
      transform: scale(1.9);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .agent-avatar[data-motion='float'],
    .agent-avatar[data-motion='float'] .agent-sparkle,
    .agent-status::after {
      animation: none;
      transform: none;
    }
  }
</style>
