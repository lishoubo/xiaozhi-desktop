/**
 * 抖音来客门店探测——参照 RPA 脚本
 * `rms-rpa-worker/rms_rpa_worker/adapters/douyin/poi_fetch.py` 的
 * `fetch_poi_store_info` 主流程移植。
 *
 * URL 判定登录成功时（douyin-login-url-matcher.ts），落地页已经是
 * `/p/home?groupid=xxx`——`groupid`（= account_id/group_id）只是账号层 ID，
 * 门店信息接口 `dsl/get` 需要的是另一套 ID `root_life_account_id`，来源是
 * `sessionStorage.PartnerPrefetchStorage.getAccountDetail.data.detail.
 * root_life_account_id`（或同层 `life_account_id`）。这份数据是页面选完
 * 公司后异步渲染写入的，不是立即可读，需要轮询等待；等不到则模拟点击左侧
 * "门店管理"菜单驱动一次 SPA 路由，触发页面重新请求。
 *
 * 直接在用户可见的登录标签页（而非新开隐藏页面）上操作——这份数据只有
 * 在真实渲染过的页面里才存在，新开页面重新导航拿不到。
 *
 * 已知未解决问题：`dsl/get` 请求（URL 已核对与真实踩点记录一致）目前
 * 稳定返回 `status_code: 106711142 "invalid param"`，重试无效。真实踩点
 * 记录显示该请求是在用户已点击进入门店管理页（/poi-manage/home）之后
 * 发起的，而当前实现在 /p/home 页面上、未经过点击菜单就已解析出
 * root_life_account_id 并直接请求，这个前提差异未验证是否是根因。
 */
import type { WebContents } from 'electron';
import { z } from 'zod';
import type { ChannelId } from '../../domain/identity';
import { toChannelId, toOtaHotelId } from '../../domain/identity';
import type { AppLogger } from '../../shared/logging';
import type { DiscoveryOutcome, DiscoveryProbe } from './discovery-probe-port';

const ACCOUNT_DETAIL_URL_TEMPLATES = [
  'https://life.douyin.com/life/merchant/v1/account/detail?account_id={gid}',
  'https://life.douyin.com/life/merchant/v1/account/detail?group_id={gid}',
  'https://life.douyin.com/life/merchant/v1/account/get_account_detail?account_id={gid}',
  'https://life.douyin.com/life/merchant/v1/partner/account/detail?account_id={gid}',
  'https://life.douyin.com/life/gate/v1/account/detail?account_id={gid}',
];

const DSL_GET_URL = 'https://life.douyin.com/life/merchant/manager/v1/dsl/get';
const LIFE_BIZ_VIEW_ID = '22';
const LIFE_ACCOUNT_BIZ_IDS = '';

/**
 * 与真实踩点记录（docs/抖音/踩点/门店信息踩点.md）核对一致的请求 URL：
 * 不带 groupid（带上会导致 invalid param）。
 */
function buildDslGetUrl(rootLifeAccountId: string): string {
  return `${DSL_GET_URL}?root_life_account_id=${rootLifeAccountId}&life_biz_view_id=${LIFE_BIZ_VIEW_ID}&life_account_biz_ids=${LIFE_ACCOUNT_BIZ_IDS}`;
}

/**
 * 门店管理页（/poi-manage/home）只能通过点击左侧 SPA 菜单进入，直接 loadURL
 * 会 404。移植 `aside_menu.py` 的 `wait_for_aside_menu` + `_expand_submenu` +
 * `_click_data_path`：等左侧菜单渲染出来 → 展开"店铺管理"一级菜单 →
 * 点击"门店管理"二级菜单项（data-path="/poi-manage/home"）。
 */
const POI_MANAGE_DATA_PATH = '/poi-manage/home';
const POI_MANAGE_PARENT_CLASS = 'navi_shop';
const MENU_READY_TIMEOUT_MS = 4000;
const MENU_READY_POLL_MS = 350;
const AFTER_CLICK_WAIT_MS = 2000;

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
    const target = ${JSON.stringify(POI_MANAGE_DATA_PATH)};
    const norm = (p) => (p || '').replace(/\\/$/, '');

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

    const want = norm(target);
    const spans = document.querySelectorAll('span[data-path]');
    for (const el of spans) {
      const dp = el.getAttribute('data-path') || '';
      if (dp === target || norm(dp) === want) {
        el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        el.click();
        return true;
      }
    }
    return false;
  })()
`;

const PARTNER_PREFETCH_KEY = 'PartnerPrefetchStorage';

/**
 * 真机验证确认（2026-08-04）：`sessionStorage.PartnerPrefetchStorage`
 * 反序列化后的结构是
 * `{ getAccountDetail: { data: { detail: { root_life_account_id, life_account_id, ... }, ... }, status_code }, getPassportAccount: {...} }`。
 * `getAccountDetail.data` 初始是空对象，几秒后页面自己重试成功、`data`
 * 才被填充——必须轮询等待，不能只读一次。
 */
const READ_PARTNER_PREFETCH_EXPRESSION = `
  (() => {
    try {
      const raw = sessionStorage.getItem(${JSON.stringify(PARTNER_PREFETCH_KEY)});
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  })()
`;

function extractRootLifeAccountIdFromPartnerPrefetch(raw: unknown): string {
  if (typeof raw !== 'object' || raw === null) return '';
  const block = (raw as Record<string, unknown>).getAccountDetail;
  if (typeof block !== 'object' || block === null) return '';
  const data = (block as Record<string, unknown>).data;
  if (typeof data !== 'object' || data === null) return '';
  const dataRecord = data as Record<string, unknown>;
  const detail =
    typeof dataRecord.detail === 'object' && dataRecord.detail !== null
      ? (dataRecord.detail as Record<string, unknown>)
      : {};
  const root = detail.root_life_account_id ?? detail.life_account_id ?? dataRecord.root_life_account_id;
  return typeof root === 'string' ? root.trim() : '';
}

function buildFetchJsonExpression(url: string): string {
  return `
    (() => {
      try {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', ${JSON.stringify(url)}, false);
        xhr.withCredentials = true;
        xhr.setRequestHeader('Accept', 'application/json');
        xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
        xhr.send(null);
        return { __status: xhr.status, __body: xhr.responseText };
      } catch (e) {
        return { __status: -1, __body: String(e) };
      }
    })()
  `;
}

type RawFetchResult = Readonly<{ __status: number; __body: string }>;

function isRawFetchResult(value: unknown): value is RawFetchResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).__status === 'number' &&
    typeof (value as Record<string, unknown>).__body === 'string'
  );
}

function parseFetchResult(raw: unknown): unknown {
  if (!isRawFetchResult(raw)) return null;
  if (raw.__status < 200 || raw.__status >= 300) return null;
  try {
    return JSON.parse(raw.__body);
  } catch {
    return null;
  }
}

const accountDetailSchema = z.object({
  data: z.object({
    root_life_account_id: z.string().optional(),
    detail: z
      .object({
        root_life_account_id: z.string().optional(),
      })
      .optional(),
  }),
});

function extractRootLifeAccountIdFromApiResponse(raw: unknown): string {
  const parsed = accountDetailSchema.safeParse(raw);
  if (!parsed.success) return '';
  return (parsed.data.data.root_life_account_id || parsed.data.data.detail?.root_life_account_id || '').trim();
}

/**
 * `dsl/get` 返回这个 status_code 时代表选公司后 SPA/PartnerPrefetch 常未
 * 就绪导致的瞬时状态，可以退避重试。真机验证已证实：即使这样重试，部分
 * 场景仍稳定复现该错误，不保证一定能恢复（见文件头部"已知未解决问题"）。
 */
const DSL_INVALID_PARAM_STATUS = 106711142;
const DSL_FETCH_MAX_ATTEMPTS = 4;
const DSL_FETCH_RETRY_WAIT_MS = 2000;

function isTransientDslStatus(parsed: unknown): boolean {
  if (parsed === null || typeof parsed !== 'object') return true;
  const statusCode = (parsed as Record<string, unknown>).status_code;
  return statusCode === DSL_INVALID_PARAM_STATUS;
}

const POI_ID_PATTERN = /"poiId"\s*:\s*"(\d+)"/;
const POI_NAME_PATTERN = /"poiName"\s*:\s*"([^"]+)"/;

function extractHotelFromDsl(raw: unknown): { hotelId: string; hotelName: string } | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const blob = JSON.stringify(raw);
  const idMatch = POI_ID_PATTERN.exec(blob);
  const nameMatch = POI_NAME_PATTERN.exec(blob);
  if (!idMatch || !nameMatch) return null;
  return { hotelId: idMatch[1], hotelName: nameMatch[1] };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const PREFETCH_READY_TIMEOUT_MS = 20000;
const PREFETCH_POLL_MS = 1200;

export class DouyinDiscoveryProbe implements DiscoveryProbe {
  readonly channel: ChannelId = toChannelId('douyin');

  constructor(private readonly logger: AppLogger) {}

  /**
   * 直接在登录标签页本身（用户可见）的 `webContents` 上操作——不新开任何
   * 页面。这个标签页已经由 URL 判定确认落在 `landingUrl`（带 groupid）上。
   */
  async discover(
    partitionName: string,
    landingUrl: string,
    webContents: WebContents,
  ): Promise<DiscoveryOutcome> {
    try {
      const groupId = extractGroupIdFromCurrentUrl(landingUrl);
      if (!groupId) {
        this.logger.warn('Douyin discovery: no groupid on landing URL', { partitionName, landingUrl });
        return { kind: 'none' };
      }

      const rootLifeAccountId = await this.resolveRootLifeAccountId(webContents, groupId);
      if (!rootLifeAccountId) {
        this.logger.warn('Douyin discovery: could not resolve root_life_account_id', { partitionName });
        return { kind: 'none' };
      }

      const hotel = await this.fetchDslWithRetry(webContents, rootLifeAccountId);
      if (!hotel) {
        this.logger.warn('Douyin discovery: dsl/get did not yield hotel info', { partitionName });
        return { kind: 'none' };
      }

      return {
        kind: 'single',
        hotel: { otaHotelId: toOtaHotelId(hotel.hotelId), displayName: hotel.hotelName },
      };
    } catch (error) {
      this.logger.warn('Douyin discovery failed', {
        partitionName,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      return { kind: 'none' };
    }
  }

  /**
   * 参照 RPA 脚本 `fetch_poi_dsl`：`dsl/get` 遇到瞬时状态码时退避重试
   * （最多 4 次，每次间隔 2 秒）。
   */
  private async fetchDslWithRetry(
    webContents: WebContents,
    rootLifeAccountId: string,
  ): Promise<{ hotelId: string; hotelName: string } | null> {
    const dslUrl = buildDslGetUrl(rootLifeAccountId);
    for (let attempt = 1; attempt <= DSL_FETCH_MAX_ATTEMPTS; attempt += 1) {
      const dslRawFetch: unknown = await webContents.executeJavaScript(buildFetchJsonExpression(dslUrl));
      const parsed = parseFetchResult(dslRawFetch);
      const hotel = extractHotelFromDsl(parsed);
      if (hotel) return hotel;
      if (attempt < DSL_FETCH_MAX_ATTEMPTS && isTransientDslStatus(parsed)) {
        await sleep(DSL_FETCH_RETRY_WAIT_MS);
        continue;
      }
      break;
    }
    return null;
  }

  /**
   * 参照 RPA 脚本 `ensure_account_context`：
   * ① 轮询等待 PartnerPrefetchStorage.getAccountDetail 出现（最长 20s）
   * ② 仍未出现，模拟点击"门店管理"菜单驱动 SPA 路由，再轮询一轮
   * ③ 仍未出现，退回 API 路径模板兜底。
   */
  private async resolveRootLifeAccountId(webContents: WebContents, groupId: string): Promise<string> {
    const fromPrefetch = await this.pollPartnerPrefetch(webContents, PREFETCH_READY_TIMEOUT_MS, PREFETCH_POLL_MS);
    if (fromPrefetch) return fromPrefetch;

    await this.clickPoiManageMenu(webContents);
    const fromPrefetchAfterClick = await this.pollPartnerPrefetch(
      webContents,
      PREFETCH_READY_TIMEOUT_MS,
      PREFETCH_POLL_MS,
    );
    if (fromPrefetchAfterClick) return fromPrefetchAfterClick;

    for (const template of ACCOUNT_DETAIL_URL_TEMPLATES) {
      const url = template.replace('{gid}', groupId);
      const raw: unknown = await webContents.executeJavaScript(buildFetchJsonExpression(url));
      const rootLifeAccountId = extractRootLifeAccountIdFromApiResponse(parseFetchResult(raw));
      if (rootLifeAccountId) return rootLifeAccountId;
    }
    return '';
  }

  private async pollPartnerPrefetch(webContents: WebContents, timeoutMs: number, pollMs: number): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const raw: unknown = await webContents.executeJavaScript(READ_PARTNER_PREFETCH_EXPRESSION);
      const rootLifeAccountId = extractRootLifeAccountIdFromPartnerPrefetch(raw);
      if (rootLifeAccountId) return rootLifeAccountId;
      await sleep(pollMs);
    }
    return '';
  }

  /**
   * 参照 `aside_menu.py` 的 `navigate_aside_menu`：等左侧菜单出现 → 点击
   * "门店管理"菜单项。直接在用户可见的登录标签页上模拟点击——用户会看到
   * 页面自己跳转到门店管理。点击失败（菜单未渲染出来、选择器不匹配）不
   * 抛错，调用方会走后续兜底，不阻断整条探测流程。
   */
  private async clickPoiManageMenu(webContents: WebContents): Promise<void> {
    const menuReady = await this.waitForAsideMenu(webContents);
    if (!menuReady) return;
    const clicked: unknown = await webContents.executeJavaScript(CLICK_POI_MANAGE_MENU_EXPRESSION);
    if (clicked) await sleep(AFTER_CLICK_WAIT_MS);
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

function extractGroupIdFromCurrentUrl(url: string): string {
  try {
    return new URL(url).searchParams.get('groupid') || '';
  } catch {
    return '';
  }
}
