/**
 * 携程门店探测——接口未踩点，先用 DOM 解析落地（design.md 决策 2）。
 *
 * 携程 ebooking 管理页真实 DOM 结构（已实测，抄自
 * rms-rpa-worker/rms_rpa_worker/adapters/ctrip/init_hotel_info.py）：
 *   <span class="he-ctrip-hotel-title ">
 *     <a class="he-ctrip-hotel-title-link" href="https://hotels.ctrip.com/hotels/{id}.html...">
 *       酒店名称
 *     </a>
 *   </span>
 *
 * 门店 ID 从 href 用 `/hotels?/(\d+)` 正则提取（单酒店账号 href 可能是
 * `/hotel/{id}`，多酒店账号首页链接是 `/hotels/{id}.html`，两种都要匹配）。
 *
 * 页面改版会导致选择器失效，属于本次明确接受的风险（design.md Risks）；
 * 后续接口踩点成功可直接替换本文件内部实现，不影响 DiscoveryProbe 接口。
 */
import { WebContentsView, type Session, type WebContents } from 'electron';
import { z } from 'zod';
import type { ChannelId } from '../../domain/identity';
import { toChannelId, toOtaHotelId } from '../../domain/identity';
import type { AppLogger } from '../../shared/logging';
import type { DiscoveryOutcome, DiscoveryProbe } from './discovery-probe-port';

/**
 * 携程 ebooking 多门店账号登录成功后的落地页（login.py 注释里标注的真实观察值：
 * "路径 B：多酒店账号跳转到 /home/mainland 等通用首页"）。
 * `init_hotel_info.py` 里的 `/hotel/manage` 标了 TODO 未确认，不采用。
 * 单门店账号会直接跳到 `/hotel/{id}`，此时主动导航到本 URL 仍应能看到同一个
 * 门店链接元素（待真机验证，见 design.md 决策 8 风险）。
 */
const CTRIP_MANAGEMENT_URL = 'https://ebooking.ctrip.com/home/mainland';

const parsedHotelSchema = z.array(
  z.object({
    hotelId: z.string(),
    hotelName: z.string(),
  }),
);

/**
 * 门店链接是 SPA 异步渲染出来的，`loadURL` resolve 时不保证已存在，
 * 所以在页面上下文里轮询等待，而不是仅等 `did-stop-loading`
 * （RPA 脚本里对应 `page.ele(..., timeout=15)` 的语义）。
 */
const PARSE_HOTELS_EXPRESSION = `
  new Promise((resolve) => {
    const parse = () => Array.from(document.querySelectorAll('a.he-ctrip-hotel-title-link'))
      .map((el) => {
        const href = el.getAttribute('href') || '';
        const match = href.match(/\\/hotels?\\/(\\d+)/);
        const hotelId = match ? match[1] : '';
        const hotelName = (el.textContent || '').trim();
        return { hotelId, hotelName };
      })
      .filter((hotel) => hotel.hotelId && hotel.hotelName);

    const initial = parse();
    if (initial.length > 0) {
      resolve(initial);
      return;
    }

    const interval = setInterval(() => {
      const hotels = parse();
      if (hotels.length === 0) return;
      clearInterval(interval);
      clearTimeout(timeout);
      resolve(hotels);
    }, 200);
    const timeout = setTimeout(() => {
      clearInterval(interval);
      resolve(parse());
    }, 15000);
  })
`;

export class CtripDiscoveryProbe implements DiscoveryProbe {
  readonly channel: ChannelId = toChannelId('ctrip');

  constructor(
    private readonly sessionForPartition: (partitionName: string) => Session,
    private readonly logger: AppLogger,
  ) {}

  /** `landingUrl` 未使用——携程门店信息只依赖 cookie，重新导航到固定管理页即可。 */
  async discover(
    partitionName: string,
    _landingUrl: string,
    _webContents: WebContents,
  ): Promise<DiscoveryOutcome> {
    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        session: this.sessionForPartition(partitionName),
      },
    });
    try {
      await view.webContents.loadURL(CTRIP_MANAGEMENT_URL);
      const raw: unknown = await view.webContents.executeJavaScript(PARSE_HOTELS_EXPRESSION);
      const parsed = parsedHotelSchema.safeParse(raw);
      if (!parsed.success) {
        this.logger.warn('Ctrip discovery parse failed', { partitionName });
        return { kind: 'none' };
      }
      const hotels = parsed.data.map((hotel) => ({
        otaHotelId: toOtaHotelId(hotel.hotelId),
        otaHotelName: hotel.hotelName,
      }));
      if (hotels.length === 0) return { kind: 'none' };
      if (hotels.length === 1) return { kind: 'single', hotel: hotels[0] };
      return { kind: 'multiple', hotels };
    } catch (error) {
      this.logger.warn('Ctrip discovery failed', {
        partitionName,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      return { kind: 'none' };
    } finally {
      if (!view.webContents.isDestroyed()) view.webContents.close();
    }
  }
}
