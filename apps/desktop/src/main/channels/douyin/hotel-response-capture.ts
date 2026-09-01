/**
 * 用 CDP 拦截"门店管理"页面自己发起的请求响应体——不自己拼请求，只被动监听
 * 并取回真实响应。
 *
 * ## 为什么拦两个端点
 *
 * 抖音有两种**经营模式**，「门店管理」这一个菜单在两种模式下是两个不同的页面，
 * 出数据的接口也不同（详见 `poi-account-list.ts` 的表）：单店商家点进去是那家
 * 店的详情，数据在 `dsl/get` 的 DSL 里；连锁/集团点进去是门店列表，数据在
 * `poiAccountList`。
 *
 * 两个**同时**拦、谁先出数据用谁，而不是串行 fallback：串行的话连锁账号必然先
 * 耗满单店路径的超时（点菜单 + 等页面 + 等接口，30s）才轮到第二条路，用户体感
 * 接近卡死。并行没有这个代价 —— 一次点击、一次 attach，两个响应各自到达。
 *
 * ## `loadingFinished` 而不是 `responseReceived`
 *
 * `Network.getResponseBody` 只有在请求真正加载完成（`loadingFinished`）后才保证
 * 能拿到完整 body——`responseReceived` 只代表响应头已到达，body 可能仍在流式传输
 * 中，此时调用会间歇性抛错（"No resource with given identifier found" 一类），
 * 命中率取决于响应体大小和网络时序。故先在 `responseReceived` 里记下命中的
 * requestId 及它命中的是哪个端点，真正取 body 推迟到对应的 `loadingFinished`。
 *
 * 用 Map 而非单个 `pendingRequestId`：两个端点可能同时在飞，单变量会被后到的
 * 那个覆盖掉前一个。
 *
 * ## dsl/get 的两层解析
 *
 * 对齐 RPA 参照实现 `poi_fetch.py::parse_poi_from_dsl`：
 * 1. 先正经 `JSON.parse` 响应体，取出 `dsl.extra`（本身也是一段 JSON
 *    字符串）再解析一次，读 `poi_id`——这是数据的权威来源，不依赖正则
 * 2. 拿不到再退回正则兜底，扫 `poiId`/`poiName`（RPA 对整个对象重新
 *    `json.dumps` 后正则匹配；这里响应体本身就是原始 wire text，服务端
 *    已经把内层 props 当 JSON 字符串转义嵌入，所以 `poiId`/`poiName`
 *    前后的引号天然带一个反斜杠，正则里把反斜杠设为可选以兼容）
 */
import type { WebContents } from 'electron';
import { toOtaHotelId } from '../../ids';
import { safeLogErrorDetails, type AppLogger } from '../../../shared/logging';
import { parseDouyinPoiAccountList, type DouyinPoiAccount } from './poi-account-list';

const DSL_GET_PATH = '/life/merchant/manager/v1/dsl/get';
const POI_ACCOUNT_LIST_PATH = '/life/gate/v1/account/poiAccountList';

/** 命中的是哪条路。值用于日志，让真机排查一眼看出这个账号走了哪种经营模式。 */
type CaptureSource = 'dsl-get' | 'poi-account-list';

const WATCHED_PATHS: ReadonlyMap<CaptureSource, string> = new Map([
  ['dsl-get', DSL_GET_PATH],
  ['poi-account-list', POI_ACCOUNT_LIST_PATH],
]);

const POI_ID_FALLBACK_PATTERN = /\\?"poiId\\?"\s*:\s*\\?"(\d+)\\?"/;
const POI_NAME_FALLBACK_PATTERN = /\\?"poiName\\?"\s*:\s*\\?"([^"\\]+)\\?"/;

/**
 * 一次探测的产物：一到多家门店，外加它是从哪条路来的。
 *
 * 单店路径恒为 1 家，连锁路径为 N 家 —— 上层不必区分，统一按列表处理。
 */
export type CapturedHotels = Readonly<{
  source: CaptureSource;
  hotels: readonly DouyinPoiAccount[];
  /**
   * 渠道自报的门店总数（仅 `poi-account-list` 有）。**不参与任何逻辑，只进日志**：
   * 被动拦截拿到的是页面自己发的那一页（`page_size=10`），`totalCount` 大于
   * `hotels.length` 就说明后面的门店没拿到。不记的话这种截断在日志里完全看不出来
   * —— 用户只是"少了几家店"，没有任何错误。
   */
  totalCount?: number | null;
}>;

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

function matchWatchedPath(url: string): CaptureSource | null {
  for (const [source, path] of WATCHED_PATHS) {
    if (url.includes(path)) return source;
  }
  return null;
}

export class HotelResponseCapture {
  private resolveHotels: ((captured: CapturedHotels | null) => void) | null = null;
  /** requestId → 它命中的端点。两个端点可能同时在飞，故用 Map 而非单变量。 */
  private readonly pendingRequests = new Map<string, CaptureSource>();
  private readonly onEvent = (_event: unknown, method: string, params: unknown): void => {
    if (method === 'Network.responseReceived') {
      if (!isCdpResponseReceivedParams(params)) return;
      const source = matchWatchedPath(params.response.url);
      if (!source) return;
      if (params.response.status < 200 || params.response.status >= 300) return;
      this.pendingRequests.set(params.requestId, source);
      return;
    }
    if (method === 'Network.loadingFinished') {
      if (!isCdpLoadingFinishedParams(params)) return;
      const source = this.pendingRequests.get(params.requestId);
      if (!source) return;
      this.pendingRequests.delete(params.requestId);
      void this.fetchAndResolveBody(params.requestId, source);
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
    this.pendingRequests.clear();
    // 结束等待方：detach 之后不会再有任何响应到达，让 `waitForHotels` 挂着等满 30s
    // 毫无意义。`hotel-prob.ts` 的 catch 路径正是这样——异常直奔 finally 的 detach()，
    // 而那个 promise 还悬着，连同它的定时器一起被闭包留住。当前不可观测（catch 先
    // return 了），但只要将来有人 await 它，就是一次 30s 假死。
    this.resolveHotels?.(null);
    if (this.webContents.debugger.isAttached()) {
      this.webContents.debugger.detach();
    }
  }

  /**
   * 等待两个端点里**先出数据**的那一个，超时则返回 null。
   *
   * 「先出数据」而不是「先到达」：某个端点响应到了但解析不出门店（单店账号的
   * 列表接口返回空、或连锁账号的 `dsl/get` 给不出 `poiId`）不算数，继续等另一个。
   */
  waitForHotels(timeoutMs: number): Promise<CapturedHotels | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.resolveHotels = null;
        resolve(null);
      }, timeoutMs);
      this.resolveHotels = (captured) => {
        clearTimeout(timer);
        this.resolveHotels = null;
        resolve(captured);
      };
    });
  }

  private async fetchAndResolveBody(requestId: string, source: CaptureSource): Promise<void> {
    let body: string;
    try {
      const result = (await this.webContents.debugger.sendCommand('Network.getResponseBody', {
        requestId,
      })) as { body: string; base64Encoded: boolean };
      body = result.base64Encoded
        ? Buffer.from(result.body, 'base64').toString('utf8')
        : result.body;
    } catch (error) {
      this.logger.warn('Douyin discovery: failed to read response body', {
        source,
        error: safeLogErrorDetails(error),
      });
      return;
    }

    // 已经有另一个端点先出了数据，这次不必再往下解析。
    if (!this.resolveHotels) return;

    const captured =
      source === 'dsl-get' ? capturedFromDslBody(body) : capturedFromPoiAccountListBody(body);
    if (!captured) {
      // 这不是错误：单店账号的列表接口本就出不了数据，连锁账号的 dsl/get 也一样。
      // 记 info 而非 warn —— 两个端点里总有一个会走到这里，warn 会让日志天天有噪音。
      this.logger.info('Douyin discovery: response did not yield hotels', {
        source,
        // 出**结构轮廓**而非内容：响应体里有门店名、账号名这类业务数据，而这一行每次
        // 探测必然打一次（两个端点里总有一个出不了数据），照抄原文等于把业务内容常态化
        // 写进日志。排查要判断的是「这个端点有没有返回列表」，轮廓够用。
        ...describeBodyShape(body),
      });
      return;
    }

    this.logger.info('Douyin discovery: hotels captured', {
      source,
      hotelCount: captured.hotels.length,
      // 与 hotelCount 对不上就是分页截断了，见 CapturedHotels.totalCount。
      ...(captured.totalCount == null ? {} : { totalCount: captured.totalCount }),
    });
    // 竞态：两个端点可能几乎同时出数据，先到的那个已经把 resolveHotels 置空了。
    this.resolveHotels?.(captured);
  }
}

/**
 * 响应体的结构轮廓，供解析失败时定位问题。**只出结构不出内容**：长度、顶层键名、
 * 业务码、列表条数 —— 足够判断「这个端点返回的是不是一份列表」，而门店名、账号名
 * 这些业务数据一概不进日志（见 CLAUDE.md 的日志规约）。
 */
function describeBodyShape(body: string): Record<string, unknown> {
  const bodyLength = body.length;
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== 'object' || parsed === null) {
      return { bodyLength, bodyKind: typeof parsed };
    }
    const root = parsed as Record<string, unknown>;
    const data = root.data;
    const list =
      typeof data === 'object' && data !== null
        ? (data as Record<string, unknown>).list
        : undefined;
    return {
      bodyLength,
      topLevelKeys: Object.keys(root).slice(0, 12),
      statusCode: typeof root.status_code === 'number' ? root.status_code : undefined,
      listLength: Array.isArray(list) ? list.length : undefined,
    };
  } catch {
    return { bodyLength, bodyKind: 'non-json' };
  }
}

function capturedFromDslBody(body: string): CapturedHotels | null {
  const hotel = extractHotelFromDslBody(body);
  if (!hotel) return null;
  return {
    source: 'dsl-get',
    hotels: [{ otaHotelId: toOtaHotelId(hotel.hotelId), otaHotelName: hotel.hotelName }],
  };
}

function capturedFromPoiAccountListBody(body: string): CapturedHotels | null {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return null;
  }
  const parsed = parseDouyinPoiAccountList(raw);
  if (!parsed) return null;
  return { source: 'poi-account-list', hotels: parsed.hotels, totalCount: parsed.totalCount };
}
