<script lang="ts">
  import UserRound from '@lucide/svelte/icons/user-round';

  let { name }: { name: string } = $props();
</script>

<span
  class="grid size-8 shrink-0 place-items-center rounded-lg bg-secondary text-secondary-foreground shadow-sm"
  data-user-avatar
  aria-label={`${name}的默认头像`}
  title={name}
>
  <UserRound size={17} strokeWidth={1.9} />
</span>
