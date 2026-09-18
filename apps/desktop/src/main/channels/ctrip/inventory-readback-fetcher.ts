/**
 * 在**用户当前标签页**里发起携程回读请求。
 *
 * 照 `meituan/poi-infos.ts` 的 `FETCH_MEITUAN_POI_INFOS_EXPRESSION` 模板 —— 本仓已有 6 处
 * `executeJavaScript` 发请求的先例，这不是新能力。
 *
 * ## 为什么在页面里发
 *
 * `withCredentials = true` 让浏览器自己带 cookie：不读 cookie、不拼 `Cookie:` 头。
 * 2026-08-09 那次「结构化 JSON 整串塞进 `Cookie:` 头 → 携程返回 200 + 登录页 HTML →
 * JSON 解析炸」的整类事故，在这条路上不可能发生。
 *
 * ## ⚠️ 页面脚本只负责发请求，不做解析
 *
 * 页面里的代码是**字符串**，测不了。所有解析、索引、过滤都放在主进程侧的纯函数里
 * （`inventory-readback.ts` / `room-change-targets.ts`），那些才能单测。
 *
 * ## ⚠️ 所有异常路径都 `resolve`，绝不 reject
 *
 * `executeJavaScript` 的 reject 会变成主进程的未处理拒绝。模板的做法是全路径 `resolve`，
 * 失败时给 `null`，由调用方判成 `NETWORK_ERROR`。
 *
 * ## HTTP 状态怎么传回来
 *
 * 携程登录失效**不保证**返回错误码（四种形态见 `inventory-readback.ts`），所以不能只看
 * 状态码。这里的处置：
 *
 * - 2xx → 解析 JSON 回传；解析不了就回传**原始文本**（让主进程侧的 HTML 登录页判据能工作）
 * - 403 → 回传 `{ __httpStatus: 403 }`，主进程侧单独判成 `FORBIDDEN`（**403 ≠ 401**，
 *   403 是身份认了但没权限，重登解决不了）
 * - 401 → 回传 `{ code: 401 }`，归入登录失效形态 1
 * - 其他 → `null`
 */
import type { WebContents } from 'electron';
import type { JsonObject } from '../../../shared/types/json';
import type { CtripReadbackFetcher } from './inventory-readback';

function buildExpression(url: string, body: JsonObject, timeoutMs: number): string {
  return `
  new Promise((resolve) => {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', ${JSON.stringify(url)}, true);
      xhr.withCredentials = true;
      xhr.timeout = ${JSON.stringify(timeoutMs)};
      xhr.setRequestHeader('Content-Type', 'application/json;charset=UTF-8');
      xhr.setRequestHeader('Accept', 'application/json');
      xhr.onload = () => {
        // 403 与 401 要让主进程侧分开判：403 是没权限（重登无用），401 是登录失效。
        if (xhr.status === 403) { resolve({ __httpStatus: 403 }); return; }
        if (xhr.status === 401) { resolve({ code: 401 }); return; }
        if (xhr.status < 200 || xhr.status >= 300) { resolve(null); return; }
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch (error) {
          // 解析不了就把原文回传 —— 携程失效时会返回 HTTP 200 + 整页登录页 HTML，
          // 那种情况必须让主进程侧的 HTML 判据看到原文，不能吞成 null。
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

export const ctripReadbackFetcher: CtripReadbackFetcher = async (
  webContents: WebContents,
  url: string,
  body: JsonObject,
  timeoutMs: number,
): Promise<unknown> => {
  // 标签页在这之前可能已被关闭 —— 调用方会把 null 判成 NETWORK_ERROR 并放弃，不补救。
  if (webContents.isDestroyed()) return null;
  return webContents.executeJavaScript(buildExpression(url, body, timeoutMs));
};
