/**
 * 抖音酒店探测：点击左侧"门店管理"菜单，用 CDP 拦截该页面自己发起的
 * `dsl/get` 请求响应体拿到门店 ID/名称（详细踩坑背景见
 * `dsl-get-response-capture.ts`）。不重复读取账号身份——身份读取已在
 * `ota-credential` 侧完成（`discover-douyin.ts`），这里只在收到
 * `HotelProbeOutcome` 前提取当前页面 `groupid` 作为 `bindExtra`。
 */
import type { WebContents } from 'electron';
import { toOtaHotelId } from '../../../domain/identity';
import { douyinBindExtra } from '../../../domain/ota-bind-extra';
import type { AppLogger } from '../../../shared/logging';
import { isTrustedHotelUrl } from '../trusted-hotel-url';
import type { HotelProbe, HotelProbeOutcome } from '../types';
import { DslGetResponseCapture } from './dsl-get-response-capture';

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

      const capture = new DslGetResponseCapture(webContents, logger);
      try {
        await capture.attach();
        const waitForHotel = capture.waitForHotel(RESPONSE_WAIT_TIMEOUT_MS);

        await clickPoiManageMenu(webContents, logger);

        const hotel = await waitForHotel;
        if (!hotel) {
          logger.warn('Douyin hotel probe: no dsl/get response captured');
          return { kind: 'none' };
        }

        return {
          kind: 'found',
          hotels: [
            {
              otaHotelId: toOtaHotelId(hotel.hotelId),
              otaHotelName: hotel.hotelName,
              bindExtra: douyinBindExtra(groupId),
            },
          ],
        };
      } catch (error) {
        logger.warn('Douyin hotel probe failed', {
          errorName: error instanceof Error ? error.name : 'UnknownError',
        });
        return { kind: 'none' };
      } finally {
        capture.detach();
      }
    },
  };
}
