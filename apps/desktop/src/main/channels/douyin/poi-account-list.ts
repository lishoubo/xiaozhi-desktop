/**
 * 抖音**连锁/集团**账号的门店列表解析。
 *
 * 与同目录 `hotel-response-capture.ts` 是「同一次点击、两条并列的路」，不是
 * 主备关系 —— 它们对应抖音的两种**经营模式**，而不是同一份数据的两种取法：
 *
 * | 经营模式 | 页面 | 出数据的接口 | 门店数 |
 * |---|---|---|---|
 * | 单店商家 | 门店管理 = 那家店的详情 | `dsl/get`（详情页 DSL 里嵌着 `poiId`） | 恒为 1 |
 * | 连锁/集团 | 门店管理 = 门店列表 | `poiAccountList`（本文件） | N |
 *
 * 两个端点**同时拦、谁出数据用谁**，不做经营模式的前置判据 —— 判据落在「哪个接口
 * 真的返回了门店」这个事实上，而不是靠猜 `account_type` / `virtual_account_type`
 * 这类字段的语义。实测（2026-09-01，连锁账号）只有 `poiAccountList` 到达，
 * `dsl/get` 一次都没发，两者并未同时出数据。
 *
 * 同样**不自己拼请求**：`poiAccountList` 是「门店管理」页自己会发的请求，现有探测
 * 流程已经在点那个菜单、已经 attach 了 CDP，被动拦截即可。这么做绕开了三样东西
 * —— `root_life_account_id`（页面 URL 上只有 `groupid`，两者不是一回事，我们无处
 * 可取）、`x-secsdk-csrf-token`、以及一堆 `rpc-persist-*` 头。
 */
import { z } from 'zod';
import { toOtaHotelId, type OtaHotelId } from '../../ids';

/** 抖音自定义的成功码，与 HTTP 状态无关。 */
const DOUYIN_SUCCESS_STATUS_CODE = 0;

/**
 * 一条门店记录。字段全部宽松：这份响应里绝大多数字段与绑定无关，只取
 * 「门店 ID + 能给人看的名字」，多余字段一律忽略（zod 默认行为）。
 *
 * `poi_id` 顶层与 `detail.poi_id` 都有，取顶层；名字优先 `account_name`，
 * 退到 `detail.life_account_name`。
 */
const poiAccountSchema = z.object({
  poi_id: z.union([z.string(), z.number()]).optional(),
  account_name: z.string().optional(),
  detail: z
    .object({
      poi_id: z.union([z.string(), z.number()]).optional(),
      life_account_name: z.string().optional(),
    })
    .optional(),
});

const poiAccountListResponseSchema = z.object({
  status_code: z.union([z.number(), z.string()]).optional(),
  data: z
    .object({
      list: z.array(poiAccountSchema).optional(),
      pagination: z
        .object({
          page_count: z.number().optional(),
          page_index: z.number().optional(),
          total_count: z.number().optional(),
        })
        .optional(),
    })
    .optional(),
});

export type DouyinPoiAccount = Readonly<{
  otaHotelId: OtaHotelId;
  otaHotelName: string | null;
}>;

/**
 * 解析出的列表 + 分页事实。
 *
 * `totalCount` / `pageCount` **不参与任何逻辑，只用于日志**：被动拦截拿到的是页面
 * 自己发的那一页（`page_size=10`），总数大于本页条数就是被截断了 —— 不记的话这种
 * 截断在日志里完全看不出来。真正的翻页需要主动请求，不在被动拦截的能力范围内。
 */
export type DouyinPoiAccountList = Readonly<{
  hotels: readonly DouyinPoiAccount[];
  totalCount: number | null;
  pageCount: number | null;
}>;

function nonBlank(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function poiIdOf(poi: z.infer<typeof poiAccountSchema>): string {
  const raw = poi.poi_id ?? poi.detail?.poi_id;
  return raw == null ? '' : String(raw).trim();
}

/**
 * 解析 `poiAccountList` 响应。返回 `null` 表示「这个响应不是一份可用的门店列表」
 * ——形状不对、业务码非 0，或一条能用的记录都没有。调用方据此判定该走另一条路。
 *
 * **不按 `status` / `poi_open_status` 过滤门店**：过滤掉的门店用户就选不到了，
 * 而「这家店能不能绑」是远端的判断，不是 desktop 的。宁可全列出来让用户自己认。
 */
export function parseDouyinPoiAccountList(raw: unknown): DouyinPoiAccountList | null {
  const parsed = poiAccountListResponseSchema.safeParse(raw);
  if (!parsed.success) return null;

  const statusCode = parsed.data.status_code;
  if (statusCode !== undefined && String(statusCode) !== String(DOUYIN_SUCCESS_STATUS_CODE)) {
    return null;
  }

  const hotels = (parsed.data.data?.list ?? []).flatMap((poi): readonly DouyinPoiAccount[] => {
    const otaHotelId = poiIdOf(poi);
    if (otaHotelId.length === 0) return [];
    return [
      {
        otaHotelId: toOtaHotelId(otaHotelId),
        otaHotelName: nonBlank(poi.account_name) ?? nonBlank(poi.detail?.life_account_name),
      },
    ];
  });

  if (hotels.length === 0) return null;

  const pagination = parsed.data.data?.pagination;
  return {
    hotels,
    totalCount: pagination?.total_count ?? null,
    pageCount: pagination?.page_count ?? null,
  };
}
