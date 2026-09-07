/**
 * 用 CDP `Network.getAllCookies` 采集完整 cookie —— **唯一能拿到 CHIPS 分区键的路径**。
 *
 * ## 为什么必须走 CDP
 *
 * Electron 的 `session.cookies.get()` 返回结构里根本没有 `partitionKey` 字段
 * （Electron 43 `Cookie` 只有 domain/expirationDate/hostOnly/httpOnly/name/path/
 * sameSite/secure/session/value）。实测同一份抖音登录态：两条路径**都返回 38 条**，
 * 但 CDP 能标出其中 13 条带分区键，Electron API 标不出 —— 分区与非分区的同名 cookie
 * 在它眼里长得一模一样，上送后被远端按 `(name,domain,path,partitionKey)` 去重塌缩，
 * 登录票据（sessionid_ls / sid_tt_ls / uid_tt_ls …）因此丢失。
 *
 * ## 为什么不用 Page.getCookies
 *
 * 它只返回当前页面域下的 cookie。抖音登录态跨 `.douyin.com` / `.life.douyin.com` /
 * `.bytedance.com` / `.oceanengine.com` 四个域，SSO 票据分散其中，漏任一域都残缺。
 *
 * ## 为什么不调 Network.enable
 *
 * `getAllCookies` 是即时查询，不订阅任何事件。`Network.enable` 只有在需要收
 * `requestWillBeSent` 一类事件时才必要（见 `amount-save-capture.ts`），这里多调
 * 一次只会平白增加对页面的干扰。
 */
import type { WebContents } from 'electron';
import { safeLogErrorDetails, type AppLogger } from '../../../shared/logging';
import type { CollectedCookie } from './to-snapshot-entry';

/** CDP 不可用的原因，用于日志留痕与后续判断是否需要重试策略。 */
export type CdpUnavailableReason = 'no-tab' | 'debugger-busy' | 'attach-failed' | 'command-failed';

export type CdpCollectResult =
  | Readonly<{ ok: true; cookies: readonly CollectedCookie[] }>
  | Readonly<{ ok: false; reason: CdpUnavailableReason }>;

type CdpCookie = Readonly<{
  name?: unknown;
  value?: unknown;
  domain?: unknown;
  path?: unknown;
  secure?: unknown;
  httpOnly?: unknown;
  sameSite?: unknown;
  expires?: unknown;
  session?: unknown;
  partitionKey?: unknown;
}>;

function isCdpCookieList(value: unknown): value is Readonly<{ cookies: readonly CdpCookie[] }> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { cookies?: unknown }).cookies)
  );
}

/**
 * CDP 返回的一条 → 映射层的中间形状。
 *
 * 只做**类型收窄**，不做任何取值加工：省略规则全部由 `to-snapshot-entry` 负责，
 * 两条采集路径必须共用同一套规则，否则降级前后产出的快照形状会悄悄不一致。
 */
function toCollected(cookie: CdpCookie): CollectedCookie | null {
  if (typeof cookie.name !== 'string' || typeof cookie.value !== 'string') return null;
  return {
    name: cookie.name,
    value: cookie.value,
    ...(typeof cookie.domain === 'string' ? { domain: cookie.domain } : {}),
    ...(typeof cookie.path === 'string' ? { path: cookie.path } : {}),
    ...(typeof cookie.secure === 'boolean' ? { secure: cookie.secure } : {}),
    ...(typeof cookie.httpOnly === 'boolean' ? { httpOnly: cookie.httpOnly } : {}),
    ...(typeof cookie.sameSite === 'string' ? { sameSite: cookie.sameSite } : {}),
    ...(typeof cookie.expires === 'number' ? { expires: cookie.expires } : {}),
    ...(typeof cookie.session === 'boolean' ? { session: cookie.session } : {}),
    // 原样搬运，不校验形态：不同 Chrome 版本给对象或字符串，我们都不该解读
    ...(cookie.partitionKey != null ? { partitionKey: cookie.partitionKey } : {}),
  };
}

/**
 * 在给定标签页上取一次全量 cookie。
 *
 * **debugger 独占**：`isAttached()` 为 true 说明探测链路（`HotelProbe`）正占着它。
 * 此时**不抢占**——探测是用户正在等结果的前台流程，抢占会让绑定流程失败
 * （见 `amount-save-capture.ts` 同款约束）。直接返回不可用，由调用方降级。
 *
 * 只 detach 自己 attach 的那次，理由同上。
 */
export async function collectViaCdp(
  webContents: WebContents | null,
  logger: AppLogger,
): Promise<CdpCollectResult> {
  if (!webContents || webContents.isDestroyed()) return { ok: false, reason: 'no-tab' };

  const { debugger: dbg } = webContents;
  if (dbg.isAttached()) return { ok: false, reason: 'debugger-busy' };

  try {
    dbg.attach('1.3');
  } catch (error) {
    logger.warn('Cookie snapshot: CDP attach failed', { error: safeLogErrorDetails(error) });
    return { ok: false, reason: 'attach-failed' };
  }

  try {
    const result: unknown = await dbg.sendCommand('Network.getAllCookies');
    if (!isCdpCookieList(result)) return { ok: false, reason: 'command-failed' };

    const cookies = result.cookies
      .map(toCollected)
      .filter((cookie): cookie is CollectedCookie => cookie !== null);
    return { ok: true, cookies };
  } catch (error) {
    logger.warn('Cookie snapshot: CDP getAllCookies failed', {
      error: safeLogErrorDetails(error),
    });
    return { ok: false, reason: 'command-failed' };
  } finally {
    // 只关自己开的门。isAttached 再查一次：页面可能在 await 期间被销毁。
    if (dbg.isAttached()) {
      try {
        dbg.detach();
      } catch {
        // detach 失败无补救手段，也不影响已取到的结果，静默即可
      }
    }
  }
}
