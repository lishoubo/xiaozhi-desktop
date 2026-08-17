/**
 * 账号列表分页 —— 「重新登录」与「新增绑定」两个弹窗共用。
 *
 * 两处形状相同：一列可选凭证，数量随用户登录的账号增长，一次性全渲染会变成很长的
 * 滚动条，需要标注（「上次绑定过」）的那一条也会淹没其中。
 *
 * 只做分页，不做搜索：本轮范围（见
 * `openspec/changes/reauth-intent-and-legacy-binding/design.md` §2）。
 */

import { paginate } from './model';

/** 每页条数：账号列表是弹窗里的次要区域，一屏放得下又不逼用户频繁翻页。 */
export const CREDENTIAL_PAGE_SIZE = 5;

export type Pagination<T> = {
  /** 当前页的条目。 */
  readonly items: readonly T[];
  /** 从 1 开始的当前页码，已钳在合法范围内。 */
  readonly page: number;
  readonly pageCount: number;
  readonly total: number;
  readonly canPrev: boolean;
  readonly canNext: boolean;
  prev(): void;
  next(): void;
  /** 列表数据源变了（换了渠道、重新加载）时回到第一页。 */
  reset(): void;
};

/**
 * `source` 传函数而不是数组：调用方的列表是 `$derived` 的，传值会在创建时就固化。
 *
 * 切片与越界钳制复用 `model.ts` 的 `paginate`（酒店列表也用它），这里只补上
 * 「页码是可变状态」这一层 —— 那个是纯函数，页码由调用方持有。
 *
 * 页码从 1 开始，与 `paginate` 一致。
 */
export function createPagination<T>(
  source: () => readonly T[],
  pageSize: number = CREDENTIAL_PAGE_SIZE,
): Pagination<T> {
  let page = $state(1);

  const derived = $derived(paginate(source(), page, pageSize));

  return {
    get items() {
      return derived.pageItems;
    },
    get page() {
      return derived.safePage;
    },
    get pageCount() {
      return derived.totalPages;
    },
    get total() {
      return source().length;
    },
    get canPrev() {
      return derived.safePage > 1;
    },
    get canNext() {
      return derived.safePage < derived.totalPages;
    },
    prev() {
      page = Math.max(1, derived.safePage - 1);
    },
    next() {
      page = Math.min(derived.totalPages, derived.safePage + 1);
    },
    reset() {
      page = 1;
    },
  };
}
