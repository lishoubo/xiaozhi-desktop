/**
 * 美团响应的成败判据 —— **回读与定时扫描共用这一份**。
 *
 * ## 为什么抽出来而不是各写一份
 *
 * 两条路径打的是同一批端点（`queryRoomStatusInfo` 两边都用）。各写一份判据，两边迟早
 * 会漂：一边补了新的失效码另一边没跟，而失效方式很隐蔽 —— 同一种失效在两条路上报出
 * 不同的 reason，排查时看日志会以为是两个问题。
 *
 * ⚠️ **只在美团内部共用，不上升到 `channels/` 顶层**：各渠道的成功码与失效形态完全不同
 * （携程 `code === 200` + 四形态含 HTML 登录页，美团 `code === 10000`），抽成「支持所有
 * 渠道所有形态」的参数化函数会把判据挤回调用方，或逼出一个怪物。携程那边同名文件
 * （`ctrip/session-expiry.ts`）是同一手法的另一份。
 *
 * ## 失效判据只判有确定语义的四种
 *
 * - HTTP 401 → `COOKIE_EXPIRED`
 * - HTTP 403 → `FORBIDDEN`（**403 ≠ 401**：身份认了但没权限，重登解决不了，
 *   归成 `COOKIE_EXPIRED` 会掩盖真因并触发一轮无意义的重新登录）
 * - 业务码 `606` → `COOKIE_EXPIRED`（见下）
 * - 其余 `code !== 10000` → `PARSE_ERROR`（**不猜其他 code**，没有样本）
 *
 * ## 失效码 `606`：两次真机样本
 *
 * ```
 * 2026-09-21  连通性验证     status 200  application/json  bodyLength 34  code 606
 * 2026-09-25  定时扫描       code 606  无 msg 字段
 *             同一账号打开标签页时账号发现拿不到身份（outcome: none）—— 独立印证已掉线
 * ```
 *
 * 结论：**美团失效时返回 200 + JSON + 业务码**，不是 HTML 登录页。
 *
 * ⚠️ 判成 `COOKIE_EXPIRED` 会让用户看到「登录已过期」提醒（定时扫描按轮汇总）——
 * 判错的代价是一次误提醒，所以只收有印证的码，不按码段猜。
 *
 * ## ⚠️ 「200 + 登录页 HTML」刻意不判
 *
 * 携程有这条判据，是因为它继承自 `rms-rpa-worker` —— 那是**后台无人值守**跑的，
 * cookie 放几天不用，失效是常态。
 *
 * 美团这两条路都不一样：回读发生在用户刚操作成功的那个标签页里（上一秒才保存成功），
 * 扫描则已实证失效时返回的是 JSON 而非 HTML。为此去猜登录页特征，收益为负：猜错会
 * 恒假、单测全绿、线上照样落 `PARSE_ERROR`，还在代码里留下一段「看起来已处理」的假象。
 */
import type { JsonObject } from '../../../shared/types/json';
import type { ReadbackFailureReason } from '../types';

/**
 * 美团认「成功」的业务码。
 *
 * ⚠️ **是 10000，不是 200 也不是 0** —— 与携程（`code: 200`）、抖音
 * （`BaseResp.StatusCode === 0`）都不同。判据按端点钉死，不做形状自辨。
 */
export const MEITUAN_SUCCESS_CODE = 10000;

/** 美团登录失效的业务码。来历见文件头「失效码 `606`」。 */
const MEITUAN_EXPIRED_CODE = 606;

export type MeituanParsedResponse =
  /**
   * ⚠️ `data` 是 `unknown` 而不是数组：本判据服务多个端点，而它们的 `data` 形状不同
   * （`queryRoomStatusInfo` / `queryPriceInventoryStatusInfo` 是数组，`poiInfos` /
   * `queryListAndTag` 是对象）。**形状校验归各自的取数步骤**，判据只负责判成败 ——
   * 在这里写死数组，会让 `data` 为对象的端点全部落成 `PARSE_ERROR`。
   */
  | Readonly<{ kind: 'ok'; data: unknown }>
  | Readonly<{ kind: 'failed'; reason: ReadbackFailureReason }>;

/**
 * 把一次响应判成成功或某种失败。
 *
 * @param raw fetcher 的产物。两条路径的 fetcher 形状略有不同，见下。
 *
 * ⚠️ **两条路径的 fetcher 都回传 `__httpStatus`**（回读是页面内 XHR，扫描是
 * `session.fetch`），HTTP 状态不被翻译成业务码 —— 那种翻译只对携程成立，见
 * `app-scope.ts` 的 `scanFetcher`。
 */
export function parseMeituanResponse(raw: unknown): MeituanParsedResponse {
  if (raw === null || raw === undefined) return { kind: 'failed', reason: 'NETWORK_ERROR' };
  // 非 JSON（可能是 HTML）。刻意不认 HTML 登录页特征，理由见文件头。
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { kind: 'failed', reason: 'PARSE_ERROR' };
  }

  const body = raw as JsonObject;
  // 403 ≠ 401：403 是身份认了但没权限，重登解决不了。
  //
  // ⚠️ **只认 `__httpStatus`，不认业务码 401/403**：HTTP 状态码空间与美团的业务码空间
  // 是两回事，美团业务码里的 401 不代表登录失效（既有测试钉住了这一点）。两条路径的
  // fetcher 都统一回传 `__httpStatus`，不做跨空间翻译。
  if (body.__httpStatus === 403) return { kind: 'failed', reason: 'FORBIDDEN' };
  if (body.__httpStatus === 401) return { kind: 'failed', reason: 'COOKIE_EXPIRED' };

  if (body.code === MEITUAN_EXPIRED_CODE) return { kind: 'failed', reason: 'COOKIE_EXPIRED' };
  if (body.code !== MEITUAN_SUCCESS_CODE) return { kind: 'failed', reason: 'PARSE_ERROR' };

  // `data` 缺失才算失败；形状对不对由调用方按自己那个端点判。
  // 空数组 / 空对象是**合法结果**（这些天确实没数据）。
  if (body.data === undefined || body.data === null) {
    return { kind: 'failed', reason: 'PARSE_ERROR' };
  }
  return { kind: 'ok', data: body.data };
}
