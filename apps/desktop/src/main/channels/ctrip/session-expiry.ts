/**
 * 携程响应的成功/失效判定 —— **回读与定时扫描共用这一份**。
 *
 * ## ⚠️ 这是携程专有的，不要上升成渠道无关的公共函数
 *
 * 下面每一条判据都是携程的形状：
 *
 * ```
 * 成功码      code === 200          美团是 10000
 * 失效码表    {401, 300, -1}        美团未踩点
 * 登录页标记  htl-ebk-login-web 等   美团无样本
 * ```
 *
 * 参数化成「支持所有渠道所有形态」，只会把判据挤回调用方，或逼出一个谁都读不懂的怪物。
 * 美团回读那份文件已经记过同一教训（刻意不跨渠道复用 fetcher，理由相同）。
 *
 * 复用范围**限定在 `channels/ctrip/` 内部**：扫描与回读都在这个目录下。
 */
import type { JsonObject } from '../../../shared/types/json';
import type { ReadbackFailureReason } from '../types';

/** 携程认「成功」的顶层 code。⚠️ 与订单接口的 `ResponseStatus.Ack` 不是一回事。 */
const SUCCESS_CODE = 200;

/**
 * 登录失效的四种形态 —— 携程失效**不保证**返回 HTTP 错误码。
 *
 * | # | 形态 | 判据 |
 * |---|---|---|
 * | 1 | 200 + JSON | body `code ∈ {401, 300, -1}` |
 * | 2 | 200 + HTML 登录页 | 正文含 `"islogin":false` / `htl-ebk-login-web` / `qrcodeloginswitch` |
 * | 3 | 200 + 授权失败体 | `{"error":"invalid_grant"}`，无 `code`、非 HTML |
 * | 4 | HTTP 401 | 由 fetcher 转成形态 1 的 code |
 *
 * ⚠️ 形态 2 靠 `<title>` 和域名**判不出来**：登录页 title 是「携程酒店商家管理后台」这种
 * 正常文案，全文也不含 `passport.ctrip.com`。
 */
const EXPIRED_CODES: ReadonlySet<number> = new Set([401, 300, -1]);
const LOGIN_PAGE_MARKERS: readonly string[] = [
  '"islogin":false',
  'htl-ebk-login-web',
  'qrcodeloginswitch',
];
/** 只扫正文开头，避免整页 HTML 全量 lowercase。 */
const LOGIN_PAGE_SCAN_LENGTH = 8192;

export function isCtripLoginPageHtml(raw: unknown): boolean {
  if (typeof raw !== 'string') return false;
  const head = raw.slice(0, LOGIN_PAGE_SCAN_LENGTH).toLowerCase();
  return LOGIN_PAGE_MARKERS.some((marker) => head.includes(marker));
}

/** `{"error":"invalid_grant"}` —— 无 `code`、非 HTML 的授权失败体（形态 3）。 */
function isAuthFailureBody(body: JsonObject): boolean {
  return typeof body.error === 'string' && body.code === undefined;
}

export type CtripParsedResponse =
  | Readonly<{ kind: 'ok'; data: JsonObject }>
  | Readonly<{ kind: 'failed'; reason: ReadbackFailureReason }>;

/**
 * 把一次响应判成成功或某种失败。
 *
 * ⚠️ **403 ≠ 401**：403 是身份认了但没权限，重登解决不了；归成 `COOKIE_EXPIRED` 会掩盖
 * 真因，触发一轮无意义的重新登录。
 */
export function parseCtripResponse(raw: unknown): CtripParsedResponse {
  if (raw === null || raw === undefined) return { kind: 'failed', reason: 'NETWORK_ERROR' };
  if (isCtripLoginPageHtml(raw)) return { kind: 'failed', reason: 'COOKIE_EXPIRED' };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { kind: 'failed', reason: 'PARSE_ERROR' };
  }

  const body = raw as JsonObject;
  if (body.__httpStatus === 403) return { kind: 'failed', reason: 'FORBIDDEN' };
  if (isAuthFailureBody(body)) return { kind: 'failed', reason: 'COOKIE_EXPIRED' };

  const code = body.code;
  if (typeof code === 'number' && EXPIRED_CODES.has(code)) {
    return { kind: 'failed', reason: 'COOKIE_EXPIRED' };
  }
  if (code !== SUCCESS_CODE) return { kind: 'failed', reason: 'PARSE_ERROR' };

  const data = body.data;
  if (typeof data !== 'object' || data === null) {
    // `data` 可以是数组（getRcProductList）或对象（getRoomInventoryInfo），但不能缺。
    return { kind: 'failed', reason: 'PARSE_ERROR' };
  }
  return { kind: 'ok', data: data as JsonObject };
}
