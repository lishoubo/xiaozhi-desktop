/**
 * 抖音来客门店探测。
 *
 * URL 判定登录成功时（douyin-login-url-matcher.ts），落地页是
 * `/p/home?groupid=xxx`。门店数据不在这个页面上，需要点击左侧"门店管理"
 * 菜单（SPA 路由）进入 `/p/poi-manage/home?...`，该页面加载时会自己发起
 * `life/merchant/manager/v1/dsl/get` 请求并在响应体里带出门店 ID/名称。
 *
 * 2026-08-04 真机验证确认：`dsl/get` 不是我们能自己拼参数调用的公共
 * 接口——真机抓包证实"门店管理"页面发的真实请求是 **POST**，body 为
 * `{"params":{"id":"SceneID_Shop_Manager_Pc","id_type":2,
 * "extra_param":{"router_back":"...(URL 编码 JSON，含 groupid)..."}}}`，
 * 且带一批 `x-secsdk-csrf-token` 之类的风控请求头；此前用同步 XHR 自己拼
 * GET 请求（不带 body）稳定返回 `status_code: 106711142 "invalid param"`，
 * 就是因为完全没传这个 body。**不需要逆向拼出这些请求头/body**——让页面
 * 按它原生的方式自己发这个请求，我们只被动拦截响应体解析：用
 * `webContents.debugger`（CDP）监听 `Network.responseReceived` 定位
 * `dsl/get` 请求命中，等对应的 `Network.loadingFinished` 触发后再用
 * `Network.getResponseBody` 取出完整 JSON（响应头到达不代表 body 已完整
 * 接收，过早调用会间歇性抛错，见 `DslGetResponseCapture` 类注释），字段
 * 提取逻辑对齐 RPA 参照实现 `poi_fetch.py::parse_poi_from_dsl`（`poiId`/
 * `poiName` 正则）。不侵入页面 JS 上下文，不需要关心 body/请求头结构，
 * 页面改版只要接口路径不变就不受影响。
 *
 * 之前误以为要点"商家信息"菜单（`MerchantInfo_Page_Pc` 场景），抓到的
 * 只是该页面的外壳布局 DSL，不含门店数据——真正需要点击的是"门店管理"。
 */
import type { WebContents } from 'electron';
import { toOtaHotelId } from '../../../domain/identity';
import type { JsonObject } from '../../../domain/json';
import { douyinBindExtra } from '../../../domain/ota-bind-extra';
import type { AppLogger } from '../../../shared/logging';
import {
  parseDouyinAccountIdentity,
  READ_DOUYIN_ACCOUNT_IDENTITY_EXPRESSION,
} from './account-identity';

const DSL_GET_PATH = '/life/merchant/manager/v1/dsl/get';

/**
 * "门店管理"菜单在左侧 SPA 导航里的父级分组是"店铺管理"（`navi_shop`）。
 * `data-path` 理论上是 `/poi-manage/home`，但按钮文案匹配更稳（不依赖
 * 具体路径字符串是否随页面改版变化），与真机抓包的 referer
 * `/p/poi-manage/home` 一致。
 */
const POI_MANAGE_PARENT_CLASS = 'navi_shop';
const POI_MANAGE_ITEM_TEXT = '门店管理';
const MENU_READY_TIMEOUT_MS = 4000;
const MENU_READY_POLL_MS = 350;
const RESPONSE_WAIT_TIMEOUT_MS = 30000;

const WAIT_FOR_ASIDE_MENU_EXPRESSION = `
  (() => {
    const menu = document.querySelector('.life-core-menu');
    if (!menu) return false;
    const paths = document.querySelectorAll('span[data-path]');
    return paths.length > 0;
  })()
`;

const CLICK_POI_MANAGE_MENU_EXPRESSION = `
  (() => {
    const pclass = ${JSON.stringify(POI_MANAGE_PARENT_CLASS)};
    const itemText = ${JSON.stringify(POI_MANAGE_ITEM_TEXT)};

    const title = document.querySelector('.' + pclass);
    const header = title ? title.closest('.life-core-submenu')?.querySelector('.life-core-submenu-header') : null;
    if (header) {
      const content = header.closest('.life-core-submenu')?.querySelector('.life-core-submenu-content');
      const hidden = content && content.classList.contains('life-core-submenu-content-hide');
      if (hidden) {
        header.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        header.click();
      }
    }

    const byText = [...document.querySelectorAll('span')].find(
      (s) => (s.innerText || '').trim() === itemText
    );
    if (byText) {
      byText.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      byText.click();
      return true;
    }
    return false;
  })()
`;

/**
 * 对齐 RPA 参照实现 `poi_fetch.py::parse_poi_from_dsl` 的两层解析：
 * 1. 先正经 `JSON.parse` 响应体，取出 `dsl.extra`（本身也是一段 JSON
 *    字符串）再解析一次，读 `poi_id`——这是数据的权威来源，不依赖正则
 * 2. 拿不到再退回正则兜底，扫 `poiId`/`poiName`（RPA 对整个对象重新
 *    `json.dumps` 后正则匹配；这里响应体本身就是原始 wire text，服务端
 *    已经把内层 props 当 JSON 字符串转义嵌入，所以 `poiId`/`poiName`
 *    前后的引号天然带一个反斜杠，正则里把反斜杠设为可选以兼容）
 */
const POI_ID_FALLBACK_PATTERN = /\\?"poiId\\?"\s*:\s*\\?"(\d+)\\?"/;
const POI_NAME_FALLBACK_PATTERN = /\\?"poiName\\?"\s*:\s*\\?"([^"\\]+)\\?"/;

function extractPoiIdFromExtra(dsl: unknown): string {
  if (typeof dsl !== 'object' || dsl === null) return '';
  const extraRaw = (dsl as Record<string, unknown>).extra;
  if (typeof extraRaw !== 'string' || !extraRaw) return '';
  try {
    const extra: unknown = JSON.parse(extraRaw);
    if (typeof extra !== 'object' || extra === null) return '';
    const poiId = (extra as Record<string, unknown>).poi_id;
    return typeof poiId === 'string' ? poiId.trim() : '';
  } catch {
    return '';
  }
}

function unwrapDslBlock(response: unknown): unknown {
  if (typeof response !== 'object' || response === null) return null;
  const r = response as Record<string, unknown>;
  if (typeof r.dsl === 'object' && r.dsl !== null) return r.dsl;
  const data = r.data;
  if (typeof data === 'object' && data !== null) {
    const dataDsl = (data as Record<string, unknown>).dsl;
    if (typeof dataDsl === 'object' && dataDsl !== null) return dataDsl;
  }
  return null;
}

function extractHotelFromDslBody(body: string): { hotelId: string; hotelName: string } | null {
  let hotelId = '';
  try {
    const response: unknown = JSON.parse(body);
    hotelId = extractPoiIdFromExtra(unwrapDslBlock(response));
  } catch {
    // 响应体不是合法 JSON，走正则兜底
  }
  if (!hotelId) {
    const idMatch = POI_ID_FALLBACK_PATTERN.exec(body);
    hotelId = idMatch ? idMatch[1] : '';
  }
  const nameMatch = POI_NAME_FALLBACK_PATTERN.exec(body);
  if (!hotelId || !nameMatch) return null;
  return { hotelId, hotelName: nameMatch[1] };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type CdpResponseReceivedParams = Readonly<{
  requestId: string;
  response: Readonly<{ url: string; status: number }>;
}>;

function isCdpResponseReceivedParams(value: unknown): value is CdpResponseReceivedParams {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.requestId !== 'string') return false;
  if (typeof v.response !== 'object' || v.response === null) return false;
  const response = v.response as Record<string, unknown>;
  return typeof response.url === 'string' && typeof response.status === 'number';
}

type CdpLoadingFinishedParams = Readonly<{ requestId: string }>;

function isCdpLoadingFinishedParams(value: unknown): value is CdpLoadingFinishedParams {
  if (typeof value !== 'object' || value === null) return false;
  return typeof (value as Record<string, unknown>).requestId === 'string';
}

/**
 * 用 CDP 拦截"门店管理"页面自己发起的 `dsl/get` 请求响应体——不自己拼
 * 请求，只被动监听并取回真实响应。
 *
 * `Network.getResponseBody` 只有在请求真正加载完成（`loadingFinished`）
 * 后才保证能拿到完整 body——`responseReceived` 只代表响应头已到达，body
 * 可能仍在流式传输中，此时调用会间歇性抛错（"No resource with given
 * identifier found" 一类），命中率取决于响应体大小和网络时序。故先在
 * `responseReceived` 里记下命中的 requestId，真正取 body 的时机推迟到
 * 该 requestId 对应的 `loadingFinished` 事件。
 */
class DslGetResponseCapture {
  private resolveHotel: ((hotel: { hotelId: string; hotelName: string } | null) => void) | null =
    null;
  private pendingRequestId: string | null = null;
  private readonly onEvent = (_event: unknown, method: string, params: unknown): void => {
    if (method === 'Network.responseReceived') {
      if (!isCdpResponseReceivedParams(params)) return;
      if (!params.response.url.includes(DSL_GET_PATH)) return;
      if (params.response.status < 200 || params.response.status >= 300) return;
      this.pendingRequestId = params.requestId;
      return;
    }
    if (method === 'Network.loadingFinished') {
      if (!isCdpLoadingFinishedParams(params)) return;
      if (params.requestId !== this.pendingRequestId) return;
      this.pendingRequestId = null;
      void this.fetchAndResolveBody(params.requestId);
    }
  };

  constructor(
    private readonly webContents: WebContents,
    private readonly logger: AppLogger,
  ) {}

  async attach(): Promise<void> {
    if (!this.webContents.debugger.isAttached()) {
      this.webContents.debugger.attach('1.3');
    }
    await this.webContents.debugger.sendCommand('Network.enable');
    this.webContents.debugger.on('message', this.onEvent);
  }

  detach(): void {
    this.webContents.debugger.removeListener('message', this.onEvent);
    if (this.webContents.debugger.isAttached()) {
      this.webContents.debugger.detach();
    }
  }

  /** 等待下一个命中的 dsl/get 响应，超时则返回 null。 */
  waitForHotel(timeoutMs: number): Promise<{ hotelId: string; hotelName: string } | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.resolveHotel = null;
        resolve(null);
      }, timeoutMs);
      this.resolveHotel = (hotel) => {
        clearTimeout(timer);
        this.resolveHotel = null;
        resolve(hotel);
      };
    });
  }

  private async fetchAndResolveBody(requestId: string): Promise<void> {
    try {
      const result = (await this.webContents.debugger.sendCommand('Network.getResponseBody', {
        requestId,
      })) as { body: string; base64Encoded: boolean };
      const body = result.base64Encoded
        ? Buffer.from(result.body, 'base64').toString('utf8')
        : result.body;
      const hotel = extractHotelFromDslBody(body);
      if (!hotel) {
        this.logger.warn('Douyin discovery: dsl/get response did not yield hotel info', {
          bodySnippet: body.slice(0, 200),
        });
      }
      if (hotel && this.resolveHotel) this.resolveHotel(hotel);
    } catch (error) {
      this.logger.warn('Douyin discovery: failed to read dsl/get response body', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
    }
  }
}

class DouyinDiscovery {
  constructor(private readonly logger: AppLogger) {}

  /**
   * 直接在登录标签页本身（用户可见）的 `webContents` 上操作——不新开任何
   * 页面。这个标签页已经由 URL 判定确认落在 `landingUrl`（带 groupid）上。
   */
  async discover(
    partitionName: string,
    _landingUrl: string,
    webContents: WebContents,
  ): Promise<DouyinDiscoveryResult> {
    const currentUrl = webContents.getURL();
    if (!isTrustedDouyinUrl(currentUrl)) {
      this.logger.warn('Douyin discovery rejected untrusted current URL');
      return { kind: 'none' };
    }

    const groupId = extractGroupIdFromCurrentUrl(currentUrl);
    if (!groupId) {
      this.logger.warn('Douyin discovery: no groupid on landing URL', {
        partitionName,
        landingUrl: currentUrl,
      });
      return { kind: 'none' };
    }

    let credential: ReturnType<typeof parseDouyinAccountIdentity> = null;
    for (let attempt = 0; attempt < 20 && !credential; attempt += 1) {
      const accountRaw: unknown = await webContents.executeJavaScript(
        READ_DOUYIN_ACCOUNT_IDENTITY_EXPRESSION,
      );
      credential = parseDouyinAccountIdentity(accountRaw);
      if (!credential) await sleep(250);
    }
    if (!credential) {
      this.logger.warn('Douyin discovery: no valid account identity in session storage');
      return { kind: 'none' };
    }

    const capture = new DslGetResponseCapture(webContents, this.logger);
    try {
      await capture.attach();
      const waitForHotel = capture.waitForHotel(RESPONSE_WAIT_TIMEOUT_MS);

      await this.clickPoiManageMenu(webContents);

      const hotel = await waitForHotel;
      if (!hotel) {
        this.logger.warn('Douyin discovery: no dsl/get response captured', { partitionName });
        return { kind: 'none' };
      }

      return {
        kind: 'found',
        credential,
        hotels: [
          {
            otaHotelId: toOtaHotelId(hotel.hotelId),
            otaHotelName: hotel.hotelName,
            bindExtra: douyinBindExtra(groupId),
          },
        ],
      };
    } catch (error) {
      this.logger.warn('Douyin discovery failed', {
        partitionName,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      return { kind: 'none' };
    } finally {
      capture.detach();
    }
  }

  /**
   * 等左侧菜单出现 → 点击"门店管理"菜单项。直接在用户可见的登录标签页
   * 上模拟点击——用户会看到页面自己跳转。点击失败（菜单未渲染出来、
   * 选择器不匹配）不抛错，调用方的响应等待会自然超时返回 none。
   */
  private async clickPoiManageMenu(webContents: WebContents): Promise<void> {
    const menuReady = await this.waitForAsideMenu(webContents);
    if (!menuReady) {
      this.logger.warn('Douyin discovery: aside menu never became ready');
      return;
    }
    const clicked: unknown = await webContents.executeJavaScript(CLICK_POI_MANAGE_MENU_EXPRESSION);
    if (!clicked) {
      this.logger.warn('Douyin discovery: poi manage menu item not found');
    }
  }

  private async waitForAsideMenu(webContents: WebContents): Promise<boolean> {
    const deadline = Date.now() + MENU_READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const ready: unknown = await webContents.executeJavaScript(WAIT_FOR_ASIDE_MENU_EXPRESSION);
      if (ready === true) return true;
      await sleep(MENU_READY_POLL_MS);
    }
    return false;
  }
}

export type DouyinDiscoveryResult =
  | Readonly<{ kind: 'none' }>
  | Readonly<{
      kind: 'found';
      credential: Readonly<{
        channelAccountId: string;
        credentialExtra: JsonObject;
      }>;
      hotels: readonly [
        Readonly<{
          otaHotelId: ReturnType<typeof toOtaHotelId>;
          otaHotelName: string;
          bindExtra: JsonObject | null;
        }>,
      ];
    }>;

export type DiscoverDouyin = (
  partitionName: string,
  landingUrl: string,
  webContents: WebContents,
) => Promise<DouyinDiscoveryResult>;

export function createDouyinDiscovery(logger: AppLogger): DiscoverDouyin {
  const discovery = new DouyinDiscovery(logger);
  return (partitionName, landingUrl, webContents) =>
    discovery.discover(partitionName, landingUrl, webContents);
}

function isTrustedDouyinUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'https:' && url.hostname === 'life.douyin.com';
  } catch {
    return false;
  }
}

function extractGroupIdFromCurrentUrl(url: string): string {
  try {
    return new URL(url).searchParams.get('groupid') || '';
  } catch {
    return '';
  }
}
