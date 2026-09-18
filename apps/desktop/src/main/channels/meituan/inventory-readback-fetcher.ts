/**
 * 在**用户当前标签页**里发起美团回读请求。
 *
 * 结构照 `ctrip/inventory-readback-fetcher.ts`，但**刻意不跨渠道复用**：两个渠道的失效
 * 形态判据完全不同（携程有四形态含 200+HTML 登录页，美团当前无样本），抽一个公共 fetcher
 * 会把判据挤到调用方，或逼出一个「支持所有渠道所有形态」的参数化怪物。
 *
 * ## 为什么在页面里发
 *
 * `withCredentials = true` 让浏览器自己带 cookie：不读 cookie、不拼 `Cookie:` 头。
 * 2026-08-09 携程那次「结构化 JSON 整串塞进 `Cookie:` 头 → 返回 200 + 登录页 HTML →
 * JSON 解析炸」的整类事故，在这条路上不可能发生。
 *
 * ## ⚠️ 页面脚本只负责发请求，不做解析
 *
 * 页面里的代码是**字符串**，测不了。所有解析、过滤都放在主进程侧的纯函数里
 * （`inventory-readback.ts` / `room-change-targets.ts`），那些才能单测。
 *
 * ## ⚠️ 所有异常路径都 `resolve`，绝不 reject
 *
 * `executeJavaScript` 的 reject 会变成主进程的未处理拒绝。全路径 `resolve`，失败时给
 * `null`，由调用方判成 `NETWORK_ERROR`。
 *
 * ## HTTP 状态怎么传回来
 *
 * - 2xx → 解析 JSON 回传；解析不了就回传**原始文本**（留给将来补 HTML 登录页判据用）
 * - 403 → 回传 `{ __httpStatus: 403 }`，主进程侧判成 `FORBIDDEN`（**403 ≠ 401**，
 *   403 是身份认了但没权限，重登解决不了）
 * - 401 → 回传 `{ __httpStatus: 401 }`，判成 `COOKIE_EXPIRED`
 * - 其他 → `null`
 */
import type { WebContents } from 'electron';
import type { JsonObject } from '../../../shared/types/json';

/** 页面里执行的取数函数。走 XHR + `withCredentials`。 */
export type MeituanReadbackFetcher = (
  webContents: WebContents,
  url: string,
  body: JsonObject,
  timeoutMs: number,
) => Promise<unknown>;

function buildExpression(url: string, body: JsonObject, timeoutMs: number): string {
  return `
  new Promise((resolve) => {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', ${JSON.stringify(url)}, true);
      xhr.withCredentials = true;
      xhr.timeout = ${JSON.stringify(timeoutMs)};
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.setRequestHeader('Accept', 'application/json');
      // 美团网关认这个头：页面自己的请求都带，缺了可能被判成非法来源。
      xhr.setRequestHeader('x-Requested-With', 'XMLHttpRequest');
      xhr.onload = () => {
        // 403 与 401 要让主进程侧分开判：403 是没权限（重登无用），401 是登录失效。
        if (xhr.status === 403) { resolve({ __httpStatus: 403 }); return; }
        if (xhr.status === 401) { resolve({ __httpStatus: 401 }); return; }
        if (xhr.status < 200 || xhr.status >= 300) { resolve(null); return; }
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch (error) {
          // 解析不了就把原文回传 —— 将来若发现美团失效时返回 200 + HTML，
          // 主进程侧才有原文可判。现在不猜它的特征。
          resolve(xhr.responseText);
        }
      };
      xhr.onerror = () => resolve(null);
      xhr.ontimeout = () => resolve(null);
      xhr.send(${JSON.stringify(JSON.stringify(body))});
    } catch (error) {
      resolve(null);
    }
  })
`;
}

export const meituanReadbackFetcher: MeituanReadbackFetcher = async (
  webContents: WebContents,
  url: string,
  body: JsonObject,
  timeoutMs: number,
): Promise<unknown> => {
  // 标签页在这之前可能已被关闭 —— 调用方会把 null 判成 NETWORK_ERROR 并放弃，不补救。
  if (webContents.isDestroyed()) return null;
  return webContents.executeJavaScript(buildExpression(url, body, timeoutMs));
};
