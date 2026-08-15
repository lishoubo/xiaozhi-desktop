<script lang="ts">
  /**
   * 账号列表的翻页条 —— 「重新登录」与「新增绑定」两个弹窗共用。
   * 只有一页时不渲染：单页还显示「1/1」纯属噪音。
   */
  import type { Pagination } from '../../hotel-management/paginate.svelte';
  import { Button } from '$lib/components/ui/button';

  type Props = { pagination: Pagination<unknown>; disabled?: boolean };
  const { pagination, disabled = false }: Props = $props();
</script>

{#if pagination.pageCount > 1}
  <div class="flex items-center justify-between px-1 text-xs text-muted-foreground">
    <span>第 {pagination.page} / {pagination.pageCount} 页，共 {pagination.total} 个账号</span>
    <span class="flex gap-1">
      <Button
        variant="outline"
        size="sm"
        disabled={disabled || !pagination.canPrev}
        onclick={() => pagination.prev()}
      >
        上一页
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={disabled || !pagination.canNext}
        onclick={() => pagination.next()}
      >
        下一页
      </Button>
    </span>
  </div>
{/if}
