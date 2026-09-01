/**
 * 抖音酒店探测：点击左侧"门店管理"菜单，用 CDP 拦截该页面自己发起的请求响应体
 * 拿到门店 ID/名称。
 *
 * **一个账号可能管多家门店**：抖音有两种经营模式，单店商家点「门店管理」进的是
 * 那家店的详情（数据在 `dsl/get`），连锁/集团进的是门店列表（数据在
 * `poiAccountList`）。两个端点同时拦、谁先出数据用谁，详细取舍见
 * `hotel-response-capture.ts` 与 `poi-account-list.ts`。这里对两种模式一视同仁
 * ——都当列表处理，单店只是长度为 1 的那种。
 *
 * 不重复读取账号身份——身份读取已在 `ota-credential` 侧完成
 * （`discover-douyin.ts`），这里只在收到 `HotelProbeOutcome` 前提取当前页面
 * `groupid` 作为 `bindExtra`。
 */
import type { WebContents } from 'electron';
import { douyinBindExtra } from '../../channels/bind-extra';
import { safeLogErrorDetails, type AppLogger } from '../../../shared/logging';
import { isTrustedHotelUrl } from '../trusted-hotel-url';
import type { HotelProbe, HotelProbeOutcome } from '../types';
import { HotelResponseCapture } from './hotel-response-capture';

const DOUYIN_HOTEL_HOSTNAME = 'life.douyin.com';
const HOME_PATH = '/p/home';
const GROUP_ID_PARAM = 'groupid';
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractGroupIdFromCurrentUrl(url: string): string {
  try {
    return new URL(url).searchParams.get(GROUP_ID_PARAM) || '';
  } catch {
    return '';
  }
}

async function waitForAsideMenu(webContents: WebContents): Promise<boolean> {
  const deadline = Date.now() + MENU_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const ready: unknown = await webContents.executeJavaScript(WAIT_FOR_ASIDE_MENU_EXPRESSION);
    if (ready === true) return true;
    await sleep(MENU_READY_POLL_MS);
  }
  return false;
}

async function clickPoiManageMenu(webContents: WebContents, logger: AppLogger): Promise<void> {
  const menuReady = await waitForAsideMenu(webContents);
  if (!menuReady) {
    logger.warn('Douyin hotel probe: aside menu never became ready');
    return;
  }
  const clicked: unknown = await webContents.executeJavaScript(CLICK_POI_MANAGE_MENU_EXPRESSION);
  if (!clicked) {
    logger.warn('Douyin hotel probe: poi manage menu item not found');
  }
}

export function createDouyinHotelProbe(logger: AppLogger): HotelProbe {
  return {
    isProbeableUrl(url: string): boolean {
      if (!isTrustedHotelUrl(url, DOUYIN_HOTEL_HOSTNAME)) return false;
      if (!url.includes(HOME_PATH)) return false;
      return extractGroupIdFromCurrentUrl(url).length > 0;
    },

    async probe(_credential, webContents): Promise<HotelProbeOutcome> {
      const groupId = extractGroupIdFromCurrentUrl(webContents.getURL());
      if (!groupId) return { kind: 'none' };

      const capture = new HotelResponseCapture(webContents, logger);
      try {
        await capture.attach();
        const waitForHotels = capture.waitForHotels(RESPONSE_WAIT_TIMEOUT_MS);

        await clickPoiManageMenu(webContents, logger);

        const captured = await waitForHotels;
        if (!captured) {
          logger.warn('Douyin hotel probe: neither endpoint yielded hotels before timeout');
          return { kind: 'none' };
        }

        return {
          kind: 'found',
          // `bindExtra` 对所有门店相同：`groupid` 是**账号级**的，不是门店级的
          // ——连锁账号下 N 家门店共用同一个 merchantGroupId。
          hotels: captured.hotels.map((hotel) => ({
            otaHotelId: hotel.otaHotelId,
            otaHotelName: hotel.otaHotelName,
            bindExtra: douyinBindExtra(groupId),
          })),
        };
      } catch (error) {
        logger.warn('Douyin hotel probe failed', {
          error: safeLogErrorDetails(error),
        });
        return { kind: 'none' };
      } finally {
        capture.detach();
      }
    },
  };
}
