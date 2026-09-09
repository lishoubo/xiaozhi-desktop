/**
 * 内部 web 页面（RMS 自有页面）的打开入口与会话续期。
 *
 * ## 为什么不走 `OtaTabService`
 *
 * 那是「OTA 标签页的唯一开口」，它的四条路都会做两件对内部页面纯属负担的事：
 * 每次新建一份 partition（且 partition 永不删除），以及往账本写一条 `pending`
 * 记录。后者更脏 —— `pending` 刻意不设数量上限，因为它是「认领链路故障」的信号；
 * 内部页面没有账号可探测，那条记录永远转不成 `claimed`，混进去会让该信号失效。
 *
 * 登录判定 / 门店探测 / cookie 采集 / 改价监听则**不需要在这里显式关闭** —— 三者
 * 都以 `channels/registry.ts` 投影出的 Map 为准，`xiaozhi` 不注册即自动不生效。
 *
 * ## 令牌与会话
 *
 * 只传 `accessToken`，不传 `refreshToken`：desktop 里登录态的持有者是主进程，页面
 * 只是显示层。把 7 天期的刷新令牌交给页面等于让它自行续期，与该职责划分矛盾。
 *
 * 令牌过期（约 8 小时）后，页面会照常跳 RMS 登录页 —— 我们**拦下这次跳转**，用主
 * 进程的登录态换一枚新令牌重新加载，用户无感。见 `createLoginRedirectGuard`。
 *
 * 也不传 `hotelId`：desktop 不维护「当前酒店」，指定一个来源不明的酒店 ID 会让改价
 * 落到错误的酒店上。页面自己从服务端 `me` 取当前酒店。
 *
 * ⚠️ URL 里含令牌，**不得写进日志或错误上报**。
 */
import { z } from 'zod';
import type { BrowserTab } from '../../shared/browser';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import type { AppLogger } from '../../shared/logging';
import { createHandlerRegistry, type TrustedWindow } from './create-handler-registry';

const noArgumentsSchema = z.tuple([]);

/**
 * 导航守卫拿到的上下文。
 *
 * **本层自己声明**，不从 `browser/` import —— eslint 禁止 `ipc/` 依赖基础设施
 * （`no-restricted-imports`），与本文件里 `InternalPageTabOpener` 声明自己需要什么
 * 是同一手法：结构上兼容 `BrowserManager` 传出来的形状，但不产生模块依赖。
 */
export type NavigationContext = Readonly<{
  tabId: string;
  channelId: string;
  /** 导航目标。⚠️ 可能带令牌，**不得写进日志**。 */
  url: string;
}>;

/** 内部页面用的渠道标识。不在 `channels/registry.ts` 注册 —— 见文件头。 */
export const INTERNAL_PAGE_CHANNEL_ID = 'xiaozhi';

/** 统一改价页在 RMS web 前端里的路径。 */
const UNIFIED_PRICING_PATH = '/unified-pricing';

/** RMS 前端的登录页路径 —— 页面登录态失效时会跳这里。 */
const RMS_LOGIN_PATH = '/login';

/**
 * 同一个标签页最多连续拦截几次登录页跳转。
 *
 * 超过就关掉它，**不再重载**：正常情况下一次续期就该解决问题，若换了新令牌还是被
 * 跳走，说明问题不在令牌上（例如服务端拒绝该身份）。没有上限的话这里会变成
 * 「拦截 → 重载 → 又跳 → 再拦截」的死循环，页面疯狂闪烁且打不开。
 */
const MAX_LOGIN_REDIRECTS_PER_TAB = 2;

/** handler 声明自己需要什么，由 composition root 满足；不 import 实现类。 */
export interface InternalPageTabOpener {
  createWithAlreadyPartition(partitionName: string, channelId: string, url: string): BrowserTab;
  activate(tabId: string): BrowserTab;
  list(): readonly BrowserTab[];
  loadUrl(tabId: string, url: string): void;
  close(tabId: string): void;
}

export type RegisterInternalPageHandlersOptions = Readonly<{
  window: TrustedWindow;
  browserManager: InternalPageTabOpener;
  /** RMS web 前端地址（**不是** API 地址，见 `rms-web-endpoint.ts`）。 */
  rmsWebOrigin: string;
  /** 取一枚当前可用的访问令牌，必要时内部先续期。无有效会话时抛错。 */
  accessToken: () => Promise<string>;
  partitionName: string;
  logger: AppLogger;
}>;

/**
 * 拼出带令牌的统一改价页地址。
 *
 * 单独导出是为了能脱离 Electron 直接测 —— 「有没有漏传 refreshToken / hotelId」
 * 这类断言不该依赖起一个真窗口。
 */
export function buildUnifiedPricingUrl(rmsWebOrigin: string, accessToken: string): string {
  const url = new URL(UNIFIED_PRICING_PATH, rmsWebOrigin);
  url.searchParams.set('token', accessToken);
  return url.toString();
}

/** 这次导航是不是「内部页面要跳去 RMS 登录页」。 */
export function isInternalPageLoginRedirect(
  context: NavigationContext,
  rmsWebOrigin: string,
): boolean {
  if (context.channelId !== INTERNAL_PAGE_CHANNEL_ID) return false;
  let target: URL;
  let origin: URL;
  try {
    target = new URL(context.url);
    origin = new URL(rmsWebOrigin);
  } catch {
    return false;
  }
  // 只认本 RMS 前端自己的登录页：别的站点即便路径也叫 /login 也与我们无关。
  return target.origin === origin.origin && target.pathname === RMS_LOGIN_PATH;
}

export type InternalPageSessionRecoveryOptions = Readonly<{
  browserManager: Pick<InternalPageTabOpener, 'loadUrl' | 'close'>;
  rmsWebOrigin: string;
  accessToken: () => Promise<string>;
  logger: AppLogger;
}>;

/**
 * 造一个导航守卫：拦下内部页面跳登录页的动作，换新令牌重新加载。
 *
 * 单独导出便于脱离 Electron 测试整条决策链（拦不拦、拦下之后做什么）。
 *
 * ⚠️ 守卫本身必须是**同步**的 —— `will-navigate` 的 `preventDefault` 不等异步。
 * 所以这里同步返回「拦」，续期在后台异步进行。
 */
export function createLoginRedirectGuard({
  browserManager,
  rmsWebOrigin,
  accessToken,
  logger,
}: InternalPageSessionRecoveryOptions): (context: NavigationContext) => boolean {
  /** 每个 tab 已经连续拦了几次。成功重载后不清零 —— 清零就等于没有上限。 */
  const redirectCounts = new Map<string, number>();

  return (context) => {
    if (!isInternalPageLoginRedirect(context, rmsWebOrigin)) return false;

    const attempts = (redirectCounts.get(context.tabId) ?? 0) + 1;
    redirectCounts.set(context.tabId, attempts);

    if (attempts > MAX_LOGIN_REDIRECTS_PER_TAB) {
      logger.warn('Internal page kept redirecting to login; closing tab', { attempts });
      redirectCounts.delete(context.tabId);
      browserManager.close(context.tabId);
      return true;
    }

    logger.info('Internal page login redirect intercepted; renewing session', { attempts });
    void (async () => {
      try {
        const token = await accessToken();
        browserManager.loadUrl(context.tabId, buildUnifiedPricingUrl(rmsWebOrigin, token));
      } catch (error) {
        // 主进程会话也没了 —— 关掉标签页，让用户走 App 自身的登录流程。
        // **不能**放它落到 RMS 登录页：desktop 用户在那里没有可用的登录手段
        // （登录入口在应用自身，且可能是短信登录）。
        logger.warn('Internal page session could not be renewed; closing tab', {
          errorName: error instanceof Error ? error.name : 'UnknownError',
        });
        redirectCounts.delete(context.tabId);
        browserManager.close(context.tabId);
      }
    })();
    return true;
  };
}

export function registerInternalPageHandlers({
  window,
  browserManager,
  rmsWebOrigin,
  accessToken,
  partitionName,
  logger,
}: RegisterInternalPageHandlersOptions): () => void {
  const registry = createHandlerRegistry({ window, logger });

  registry.handle(
    IPC_CHANNELS.internalPage.open,
    noArgumentsSchema,
    '请求参数无效',
    async (): Promise<BrowserTab> => {
      // 已经开着就复用：改价页开多个没有意义，且各自令牌的过期时刻不同会造成困惑。
      const existing = browserManager
        .list()
        .find((tab) => tab.channelId === INTERNAL_PAGE_CHANNEL_ID);
      if (existing) {
        logger.info('Internal page tab reused');
        return browserManager.activate(existing.id);
      }

      // 无有效会话时**不开 tab**，转成用户能照做的文案 —— 原始的「尚未登录」在这个
      // 入口上没有指向性。刻意不静默开一个未登录的页面：那会让用户看到 RMS 的登录页，
      // 而他在那里没有可用的登录手段（登录入口在应用自身，且可能是短信登录）。
      let token: string;
      try {
        token = await accessToken();
      } catch (error) {
        // 只记错误类型，不记 error 本身（避免任何路径把令牌带进日志）。
        logger.warn('Internal page tab blocked: no valid RMS session');
        if (error instanceof Error && error.name === 'RmsSessionMissingError') {
          throw new Error('登录状态已失效，请重新登录后再打开');
        }
        throw error;
      }
      const url = buildUnifiedPricingUrl(rmsWebOrigin, token);

      // ⚠️ 日志只记事实，不记 url —— 它带着令牌。
      logger.info('Internal page tab opening', { channel: INTERNAL_PAGE_CHANNEL_ID });
      return browserManager.createWithAlreadyPartition(
        partitionName,
        INTERNAL_PAGE_CHANNEL_ID,
        url,
      );
    },
  );

  return () => registry.dispose();
}
