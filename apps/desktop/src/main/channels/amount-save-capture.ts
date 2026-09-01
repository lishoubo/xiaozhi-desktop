/**
 * 用 CDP 旁听渠道页面自己发出的「保存价量态」请求，把**请求体与响应结果配对**后交给上层。
 *
 * 与 `douyin/hotel-response-capture.ts` 的差异：那个只要响应体、一次性、拿到就结束；
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
 * "No resource with given identifier found"）—— 与 `hotel-response-capture.ts` 同一个坑。
 *
 * ## 为什么页面级上下文（`context`）放在这里
 *
 * 美团的改价请求体只说「卖价 +2 元」，不说「原来多少钱」，RMS 算不出改后价。补齐素材要靠
 * 用户填写时页面自己发的 `calcPriceV2`（响应里改前改后都有），在提交那条上报里一起发。
 *
 * ⚠️ 美团的 `calcPriceV2` **只重算用户当次触碰的那一部分**，所以适配器存进来的是**逐步
 * 累积**的素材，不是「最近一次」的快照。机制层不需要知道这个差别（它不解读内容），但
 * 「上报即清空」这条规则是为它服务的 —— 见下面 `handleFinished` 里那段注释。
 *
 * 这份状态放在本类而不是适配器：
 *
 * - **生命周期正好对上**。本类每个 tab 一个实例，`detach()` 即页面会话结束；`pending` 本来
 *   就是这种页面级状态，`context` 与它同生共死，不用另造 sessionId/tabId。
 * - **适配器保持无状态**。三渠道共用一份适配器实例（`registry.ts` 里建一次），给它加状态
 *   等于让所有 tab 共享，切门店就会串数据。
 *
 * 机制层**不解读** context 的内容 —— 存什么、怎么用全由适配器的 `parse` 决定，见
 * `types.ts` 的 `AmountParseResult`。
 */
import type { WebContents } from 'electron';
import type { OtaAmountChangeObserved } from '../../shared/types/amount-change';
import { safeLogErrorDetails, type AppLogger } from '../../shared/logging';
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
   * 适配器上一次交出的页面级上下文，**覆盖式**：后来的盖掉先来的。
   *
   * 取最新是安全的 —— 页面上任何影响价格的条件变更（改数值、勾选房型、改日期区间、开关
   * 周末差异定价）都会触发一次重算，所以最新那条天然与提交体同条件。不需要比对、不需要
   * TTL、不需要按房型分桶（每条 calc 本来就带着当前页面上全量的 goodsList）。
   */
  private context: JsonObject | null = null;
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
    private readonly onObserved: (report: OtaAmountChangeObserved) => void,
  ) {}

  /**
   * debugger 已被别人（`HotelProbe`）占用时**跳过本次监听**而不是抢占：探测是用户正在
   * 等结果的前台流程，监听只是旁听，抢占会让绑定流程失败。
   *
   * ⚠️ 返回值不是可有可无的：跳过时**不抛错**，调用方若不看返回值就会以为监听已生效，
   * 打出「watching started」而实际一个请求都拦不到 —— 与携程那次「监听被悄悄停掉」
   * 属同一类失效（日志上与「用户没改价」长得一模一样）。调用方必须据此决定怎么记日志。
   *
   * @returns 监听是否真的生效。false = debugger 被占用，本次没挂上。
   */
  async attach(): Promise<boolean> {
    if (this.webContents.debugger.isAttached()) {
      this.logger.warn('Amount save capture: debugger already attached, skipping', {
        url: this.webContents.getURL(),
      });
      return false;
    }
    this.webContents.debugger.attach('1.3');
    this.attachedByUs = true;
    await this.webContents.debugger.sendCommand('Network.enable');
    this.webContents.debugger.on('message', this.onEvent);
    return true;
  }

  detach(): void {
    this.pending.clear();
    // 页面会话结束，上下文随之作废 —— 下一次进改价页不该沿用上一次的试算结果。
    this.context = null;
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
        error: safeLogErrorDetails(error),
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
        error: safeLogErrorDetails(error),
      });
      return;
    }

    // 渠道自己说没成功就不上报——这是防脏数据的关键一步，理由见文件头。
    if (!this.adapter.isSuccessful(responseBody, saved.endpointId)) {
      this.logger.warn('Amount save capture: channel rejected the save, not reporting', {
        endpointId: saved.endpointId,
        bodySnippet: responseBody.slice(0, 200),
      });
      return;
    }

    // 解读交给适配器：这次拦到的是一次改动、是留作后用的素材，还是该丢弃。
    // 机制层只按返回值分流，不认识具体是哪个端点。
    const parsed = this.adapter.parse(
      {
        endpointId: saved.endpointId,
        endpointUrl: saved.endpointUrl,
        requestBody: saved.requestBody,
        responseBody,
        pageUrl: saved.pageUrl,
      },
      this.context,
    );
    if (!parsed) return;

    if (parsed.kind === 'context') {
      this.context = parsed.context;
      return;
    }

    // 上报即**消费掉**这次的上下文：它是为这一次改动攒的素材，留着会被下一次改动带上。
    //
    // 美团就是这样用的 —— `calcPriceV2` 一条条累积、`updatePriceV2` 提交时一次性倒出来。
    // 不清的话用户连续改两次价，第二次会把第一次已上报的格子再报一遍（`operationId` 不同，
    // RMS 的幂等挡不住，会被当成用户改了两次）。
    //
    // 清在机制层而非适配器：适配器**无状态**（三渠道共用一份实例），交出 report 后没有再
    // 碰这份状态的机会。「一次上报消费掉一份上下文」也是渠道无关的规则，不需要适配器表态。
    this.context = null;
    this.onObserved(parsed.report);
  }

  private matchEndpoint(url: string): string | null {
    for (const [endpointId, pathFragment] of this.adapter.watchedEndpoints) {
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
