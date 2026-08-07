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
 *
 * 对齐 RPA 参照实现 `poi_fetch.py::parse_poi_from_dsl` 的两层解析：
 * 1. 先正经 `JSON.parse` 响应体，取出 `dsl.extra`（本身也是一段 JSON
 *    字符串）再解析一次，读 `poi_id`——这是数据的权威来源，不依赖正则
 * 2. 拿不到再退回正则兜底，扫 `poiId`/`poiName`（RPA 对整个对象重新
 *    `json.dumps` 后正则匹配；这里响应体本身就是原始 wire text，服务端
 *    已经把内层 props 当 JSON 字符串转义嵌入，所以 `poiId`/`poiName`
 *    前后的引号天然带一个反斜杠，正则里把反斜杠设为可选以兼容）
 */
import type { WebContents } from 'electron';
import type { AppLogger } from '../../../../../shared/logging';

const DSL_GET_PATH = '/life/merchant/manager/v1/dsl/get';

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

export class DslGetResponseCapture {
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
