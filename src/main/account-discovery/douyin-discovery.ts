/**
 * 抖音来客门店探测——两步接口调用（不做 Prefetch/DOM 兼底，见 design.md 决策 9）。
 *
 * URL 判定登录成功时（douyin-login-url-matcher.ts），落地页已经是
 * `/p/home?groupid=xxx`——`groupid`（= account_id/group_id）只是账号层 ID，
 * 门店信息接口 `dsl/get` 需要的是另一套不相等、无法互相换算的 ID
 * `root_life_account_id`，必须先请求 `getAccountDetail` 拿到它：
 * rms-rpa-worker/.../douyin/poi_fetch.py 的 `extract_account_context`（346-377行）、
 * `_build_dsl_get_url`（521-531行）、`docs/抖音/踩点/session踩点.md`（同账号
 * group_id="1813179858562059" vs root_life_account_id="7324560848234481702"，
 * 两套编号体系）。
 *
 * 第 1 步 getAccountDetail：按 `_ACCOUNT_DETAIL_URL_TEMPLATES` 同样的路径模板顺序
 * 尝试，第一个成功解析出 root_life_account_id 的即用。
 * 第 2 步 dsl/get：用 root_life_account_id（+ groupid）请求门店管理页 DSL，
 * 正则提取 poiId/poiName（与 `parse_poi_from_dsl` 对齐的字段名）。
 *
 * 任一步失败、或最终没解析出门店，返回 `none`（不重试，见 tasks.md 待办）。
 */
import { WebContentsView, type Session } from 'electron';
import { z } from 'zod';
import type { ChannelId } from '../../domain/identity';
import { toChannelId, toOtaHotelId } from '../../domain/identity';
import type { DiscoveryOutcome, DiscoveryProbe } from '../../domain/ports/discovery';
import type { AppLogger } from '../../shared/logging';

const ACCOUNT_DETAIL_URL_TEMPLATES = [
  'https://life.douyin.com/life/merchant/v1/account/detail?account_id={gid}',
  'https://life.douyin.com/life/merchant/v1/account/detail?group_id={gid}',
  'https://life.douyin.com/life/merchant/v1/account/get_account_detail?account_id={gid}',
  'https://life.douyin.com/life/merchant/v1/partner/account/detail?account_id={gid}',
  'https://life.douyin.com/life/gate/v1/account/detail?account_id={gid}',
];

const DSL_GET_URL = 'https://life.douyin.com/life/merchant/manager/v1/dsl/get';
const LIFE_BIZ_VIEW_ID = '22';

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
        if (xhr.status >= 200 && xhr.status < 300) {
          return JSON.parse(xhr.responseText);
        }
        return null;
      } catch (e) {
        return null;
      }
    })()
  `;
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

function extractRootLifeAccountId(raw: unknown): string {
  const parsed = accountDetailSchema.safeParse(raw);
  if (!parsed.success) return '';
  return (parsed.data.data.root_life_account_id || parsed.data.data.detail?.root_life_account_id || '').trim();
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

export class DouyinDiscoveryProbe implements DiscoveryProbe {
  readonly channel: ChannelId = toChannelId('douyin');

  constructor(
    private readonly sessionForPartition: (partitionName: string) => Session,
    private readonly logger: AppLogger,
  ) {}

  async discover(partitionName: string): Promise<DiscoveryOutcome> {
    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        session: this.sessionForPartition(partitionName),
      },
    });
    try {
      await view.webContents.loadURL('https://life.douyin.com/p/home');

      const groupId = extractGroupIdFromCurrentUrl(view.webContents.getURL());
      if (!groupId) {
        this.logger.warn('Douyin discovery: no groupid on landing URL', { partitionName });
        return { kind: 'none' };
      }

      const rootLifeAccountId = await this.resolveRootLifeAccountId(view, groupId);
      if (!rootLifeAccountId) {
        this.logger.warn('Douyin discovery: getAccountDetail did not yield root_life_account_id', {
          partitionName,
        });
        return { kind: 'none' };
      }

      const dslUrl = `${DSL_GET_URL}?root_life_account_id=${rootLifeAccountId}&life_biz_view_id=${LIFE_BIZ_VIEW_ID}&groupid=${groupId}`;
      const dslRaw = await view.webContents.executeJavaScript(buildFetchJsonExpression(dslUrl));
      const hotel = extractHotelFromDsl(dslRaw);
      if (!hotel) return { kind: 'none' };

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
    } finally {
      if (!view.webContents.isDestroyed()) view.webContents.close();
    }
  }

  private async resolveRootLifeAccountId(view: WebContentsView, groupId: string): Promise<string> {
    for (const template of ACCOUNT_DETAIL_URL_TEMPLATES) {
      const url = template.replace('{gid}', groupId);
      const raw = await view.webContents.executeJavaScript(buildFetchJsonExpression(url));
      const rootLifeAccountId = extractRootLifeAccountId(raw);
      if (rootLifeAccountId) return rootLifeAccountId;
    }
    return '';
  }
}

function extractGroupIdFromCurrentUrl(url: string): string {
  try {
    return new URL(url).searchParams.get('groupid') || '';
  } catch {
    return '';
  }
}
