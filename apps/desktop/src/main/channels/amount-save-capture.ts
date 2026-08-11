/**
 * 用 CDP 旁听渠道页面自己发出的「保存价量态」请求，把**请求体与响应结果配对**后交给上层。
 *
 * 与 `douyin/dsl-get-response-capture.ts` 的差异：那个只要响应体、一次性、拿到就结束；
 * 这个要请求体 + 响应体两边配对，且长期驻留（用户可以连续改很多次价）。
 *
 * 本类**渠道无关**：拦哪些端点、这次成不成功，全部问注入的 `AmountChangeAdapter`。
 *
 * ## 为什么必须请求/响应配对
 *
 * 只读请求体就上报是错的：渠道可能拒绝这次保存（抖音的限价规则就会，踩点里有
 * `103810209 限价规则：发布的【2026-05-28】商品的价格不能低于9元` 的真实样本）。
 * 那次改价在渠道侧根本没生效，若照样上报，RMS 会按一个不存在的价格去跟价，
 * 造成渠道间价格不一致 —— 这是脏数据，比漏报严重。
 *
 * ## requestId 从哪来
 *
 * CDP 自己生成（形如 `"1234.5"`），同一个 HTTP 请求的整条事件流共用它，所以配对不需要
 * 我们发明任何关联键：
 *
 * ```
 * Network.requestWillBeSent { requestId, request{ url, postData, hasPostData } }
 *         ↓ 同一个 requestId
 * Network.responseReceived  { requestId, response{ status } }
 *         ↓ 同一个 requestId
 * Network.loadingFinished   { requestId }
 *         ↓ 用它取 body
 * Network.getResponseBody   { requestId } → { body, base64Encoded }
 * ```
 *
 * `Network.getResponseBody` 只有在 `loadingFinished` 之后才保证拿得到完整 body
 * （`responseReceived` 只代表响应头到了，body 可能还在流式传输，此时调用会间歇性报
 * "No resource with given identifier found"）—— 与 `dsl-get-response-capture.ts` 同一个坑。
 */
import type { WebContents } from 'electron';
import type { AmountSaveObserved } from '../../shared/types/amount-change';
import type { AppLogger } from '../../shared/logging';
import type { JsonObject } from '../../shared/types/json';
import type { AmountChangeAdapter } from './types';

/**
 * pending 项的存活上限。正常流程里每一项都会被 `loadingFinished` 或 `loadingFailed`
 * 清掉，这个上限只是兜底：万一某个请求两个终态事件都没来（页面被关、渠道连接被掐），
 * 残留项不该无限累积。取 60s —— 比任何正常请求都长得多，又不至于让泄漏堆太久。
 */
const PENDING_MAX_AGE_MS = 60_000;

type PendingSave = Readonly<{
  endpointId: string;
  /** 保存请求的完整 URL（含 query）—— 透传给 RMS 当复盘依据。 */
  endpointUrl: string;
  requestBody: JsonObject;
  /** 发起请求那一刻的页面 URL 快照。见 `AmountSaveObserved.pageUrl` 的注释。 */
  pageUrl: string;
  at: number;
}>;

type CdpRequestWillBeSentParams = Readonly<{
  requestId: string;
  request: Readonly<{
    url: string;
    method?: string;
    postData?: string;
    hasPostData?: boolean;
    headers?: Readonly<Record<string, string>>;
  }>;
}>;

function isCdpRequestWillBeSentParams(value: unknown): value is CdpRequestWillBeSentParams {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.requestId !== 'string') return false;
  if (typeof v.request !== 'object' || v.request === null) return false;
  return typeof (v.request as Record<string, unknown>).url === 'string';
}

/**
 * 取 `Referer` 请求头 —— 也就是**发起这个请求的那个页面**的 URL。
 *
 * 为什么不用 `webContents.getURL()`：那是**地址栏**的 URL，而渠道页面多是 SPA，页面内选了
 * 哪家门店往往只存在组件状态里，不回写地址栏。抖音就是这样：地址栏没有 `poi_id`，referer
 * 里有（踩点 `修改价格.md` 的 referer 带 `poi_id`，请求体里则一次都没出现过）。
 *
 * 顺带解决了时序问题：referer 由浏览器在发请求那一刻填好，天然就是「当刻快照」，不像
 * `getURL()` 那样存在「用户点完保存立刻切门店导致取错」的窗口。
 *
 * HTTP 头名大小写不敏感，CDP 给的大小写也不保证，所以不能直接 `headers.referer`。
 */
function refererOf(headers: Readonly<Record<string, string>> | undefined): string {
  if (!headers) return '';
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === 'referer') return value;
  }
  return '';
}

type CdpRequestIdParams = Readonly<{ requestId: string }>;

function isCdpRequestIdParams(value: unknown): value is CdpRequestIdParams {
  if (typeof value !== 'object' || value === null) return false;
  return typeof (value as Record<string, unknown>).requestId === 'string';
}

function parseJsonObject(raw: string): JsonObject | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return parsed as JsonObject;
  } catch {
    return null;
  }
}

export class AmountSaveCapture {
  private readonly pending = new Map<string, PendingSave>();
  /**
   * 只有「我们自己 attach 的」才由我们 detach。`webContents.debugger` 是**独占**的，
   * 而 `HotelProbe` 那条链路也会 attach；无条件 detach 会把别人的会话掀掉。
   */
  private attachedByUs = false;

  private readonly onEvent = (_event: unknown, method: string, params: unknown): void => {
    switch (method) {
      case 'Network.requestWillBeSent':
        void this.onRequestWillBeSent(params);
        return;
      case 'Network.loadingFinished':
        void this.onLoadingFinished(params);
        return;
      case 'Network.loadingFailed':
        // 请求失败（网络断开、被取消）。必须清理，否则这一项会一直留在 Map 里。
        if (isCdpRequestIdParams(params)) this.pending.delete(params.requestId);
        return;
      default:
        return;
    }
  };

  constructor(
    private readonly webContents: WebContents,
    private readonly adapter: AmountChangeAdapter,
    private readonly logger: AppLogger,
    private readonly onObserved: (observed: AmountSaveObserved) => void,
  ) {}

  /**
   * debugger 已被别人（`HotelProbe`）占用时**跳过本次监听**而不是抢占：探测是用户正在
   * 等结果的前台流程，监听只是旁听，抢占会让绑定流程失败。
   */
  async attach(): Promise<void> {
    if (this.webContents.debugger.isAttached()) {
      this.logger.warn('Amount save capture: debugger already attached, skipping', {
        url: this.webContents.getURL(),
      });
      return;
    }
    this.webContents.debugger.attach('1.3');
    this.attachedByUs = true;
    await this.webContents.debugger.sendCommand('Network.enable');
    this.webContents.debugger.on('message', this.onEvent);
  }

  detach(): void {
    this.pending.clear();
    if (!this.attachedByUs) return;
    this.attachedByUs = false;
    this.webContents.debugger.removeListener('message', this.onEvent);
    if (this.webContents.debugger.isAttached()) {
      this.webContents.debugger.detach();
    }
  }

  private async onRequestWillBeSent(params: unknown): Promise<void> {
    if (!isCdpRequestWillBeSentParams(params)) return;
    const endpointId = this.matchEndpoint(params.request.url);
    if (endpointId === null) return;

    const rawBody = await this.readRequestBody(params);
    if (rawBody === null) return;
    const requestBody = parseJsonObject(rawBody);
    if (requestBody === null) {
      this.logger.warn('Amount save capture: request body was not a JSON object', { endpointId });
      return;
    }

    // referer 优先：它才是「发起这次保存的那个页面」，见 refererOf 的说明。SPA 不回写地址栏
    // 时 getURL() 会缺少门店参数。referer 缺失（理论上不该）时退回地址栏，好过什么都没有。
    const pageUrl = refererOf(params.request.headers) || this.webContents.getURL();

    this.evictStalePending();
    this.pending.set(params.requestId, {
      endpointId,
      endpointUrl: params.request.url,
      requestBody,
      pageUrl,
      at: Date.now(),
    });
  }

  /**
   * `postData` 在请求体较大时会被 CDP 省略，只给 `hasPostData: true`。抖音改价一次勾多个
   * 房型就可能触发，不兜底会表现为「改的房型越多越容易静默漏报」。
   */
  private async readRequestBody(params: CdpRequestWillBeSentParams): Promise<string | null> {
    if (typeof params.request.postData === 'string' && params.request.postData.length > 0) {
      return params.request.postData;
    }
    if (params.request.hasPostData !== true) return null;
    try {
      const result = (await this.webContents.debugger.sendCommand('Network.getRequestPostData', {
        requestId: params.requestId,
      })) as { postData?: string };
      return typeof result.postData === 'string' ? result.postData : null;
    } catch (error) {
      this.logger.warn('Amount save capture: failed to read request post data', {
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      return null;
    }
  }

  private async onLoadingFinished(params: unknown): Promise<void> {
    if (!isCdpRequestIdParams(params)) return;
    const saved = this.pending.get(params.requestId);
    if (!saved) return;
    this.pending.delete(params.requestId);

    let responseBody: string;
    try {
      const result = (await this.webContents.debugger.sendCommand('Network.getResponseBody', {
        requestId: params.requestId,
      })) as { body: string; base64Encoded: boolean };
      responseBody = result.base64Encoded
        ? Buffer.from(result.body, 'base64').toString('utf8')
        : result.body;
    } catch (error) {
      this.logger.warn('Amount save capture: failed to read response body', {
        endpointId: saved.endpointId,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      return;
    }

    // 渠道自己说没成功就不上报——这是防脏数据的关键一步，理由见文件头。
    if (!this.adapter.isSuccessful(responseBody)) {
      this.logger.warn('Amount save capture: channel rejected the save, not reporting', {
        endpointId: saved.endpointId,
        bodySnippet: responseBody.slice(0, 200),
      });
      return;
    }

    this.onObserved({
      endpointId: saved.endpointId,
      endpointUrl: saved.endpointUrl,
      requestBody: saved.requestBody,
      responseBody,
      pageUrl: saved.pageUrl,
    });
  }

  private matchEndpoint(url: string): string | null {
    for (const [endpointId, pathFragment] of this.adapter.saveEndpoints) {
      if (url.includes(pathFragment)) return endpointId;
    }
    return null;
  }

  private evictStalePending(): void {
    const deadline = Date.now() - PENDING_MAX_AGE_MS;
    for (const [requestId, saved] of this.pending) {
      if (saved.at < deadline) this.pending.delete(requestId);
    }
  }
}
