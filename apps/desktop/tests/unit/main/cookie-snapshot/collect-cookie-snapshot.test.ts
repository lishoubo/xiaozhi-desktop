import { describe, expect, it, vi } from 'vitest';
import type { Session, WebContents } from 'electron';
import { collectCookieSnapshot } from '../../../../src/main/browser/cookie-snapshot/collect-cookie-snapshot';
import type { AppLogger } from '../../../../src/shared/logging';

const PARTITION = 'persist:xiaozhi:dev:douyin:a1b2c3d4';

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as AppLogger & {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
  };
}

/** Electron 会话 cookie 没有 expirationDate 字段，且 sameSite 用自有值域。 */
function electronSession(cookies: unknown[] = []): Session {
  return { cookies: { get: vi.fn().mockResolvedValue(cookies) } } as unknown as Session;
}

function tabWithCdp(
  cookies: unknown[],
  { busy = false }: { busy?: boolean } = {},
): WebContents {
  let attached = busy;
  return {
    isDestroyed: () => false,
    debugger: {
      isAttached: () => attached,
      attach: () => {
        attached = true;
      },
      detach: () => {
        attached = false;
      },
      sendCommand: vi.fn().mockResolvedValue({ cookies }),
    },
  } as unknown as WebContents;
}

describe('cookie 快照采集编排', () => {
  it('CDP 可用时走 CDP，快照带上分区键', async () => {
    const partitionKey = { topLevelSite: 'https://douyin.com', hasCrossSiteAncestor: false };
    const logger = createLogger();

    const entries = await collectCookieSnapshot({
      partitionName: PARTITION,
      session: electronSession(),
      webContentsForPartition: () =>
        tabWithCdp([
          { name: 'sessionid_ls', value: 'x', domain: '.life.douyin.com', partitionKey },
          { name: 'plain', value: 'y', domain: '.douyin.com' },
        ]),
      logger,
    });

    expect(entries).toHaveLength(2);
    expect(entries[0]?.partitionKey).toEqual(partitionKey);
    expect(logger.info).toHaveBeenCalledWith(
      'Cookie snapshot collected',
      expect.objectContaining({ source: 'cdp', count: 2, partitionedCount: 1 }),
    );
  });

  it('没有标签页时降级到 Electron session，并补齐五个字段', async () => {
    const logger = createLogger();

    const entries = await collectCookieSnapshot({
      partitionName: PARTITION,
      session: electronSession([
        {
          name: 'sessionid_ls',
          value: 'x',
          domain: '.life.douyin.com',
          path: '/',
          secure: true,
          httpOnly: true,
          sameSite: 'no_restriction',
          expirationDate: 1793456000.123,
          session: false,
        },
      ]),
      webContentsForPartition: () => null,
      logger,
    });

    expect(entries[0]).toEqual({
      name: 'sessionid_ls',
      value: 'x',
      domain: '.life.douyin.com',
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'None',
      expires: 1793456000.123,
    });
    // 降级的代价：拿不到分区键
    expect(entries[0]).not.toHaveProperty('partitionKey');
  });

  /**
   * 降级必须留痕，否则服务端核验对不上时无法区分「客户端没改造」和「本次降级了」。
   */
  it('降级时打 warn 日志，带 degraded 标记与原因', async () => {
    const logger = createLogger();

    await collectCookieSnapshot({
      partitionName: PARTITION,
      session: electronSession([{ name: 'a', value: '1', domain: '.x.com' }]),
      webContentsForPartition: () => null,
      logger,
    });

    expect(logger.warn).toHaveBeenCalledWith(
      'Cookie snapshot degraded: collected without partition keys',
      expect.objectContaining({
        source: 'electron-session',
        degraded: true,
        reason: 'no-tab',
        count: 1,
      }),
    );
  });

  it('debugger 被探测占用时降级，原因记为 debugger-busy', async () => {
    const logger = createLogger();

    await collectCookieSnapshot({
      partitionName: PARTITION,
      session: electronSession([{ name: 'a', value: '1', domain: '.x.com' }]),
      webContentsForPartition: () => tabWithCdp([], { busy: true }),
      logger,
    });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('degraded'),
      expect.objectContaining({ reason: 'debugger-busy' }),
    );
  });

  it('按 partitionName 查标签页，不跨账号取', async () => {
    const webContentsForPartition = vi.fn(() => null);

    await collectCookieSnapshot({
      partitionName: PARTITION,
      session: electronSession(),
      webContentsForPartition,
      logger: createLogger(),
    });

    expect(webContentsForPartition).toHaveBeenCalledExactlyOnceWith(PARTITION);
  });

  /** 日志是登录凭证的旁路泄漏点：只允许出现元信息。 */
  it('日志不含任何 cookie 取值', async () => {
    const logger = createLogger();

    await collectCookieSnapshot({
      partitionName: PARTITION,
      session: electronSession(),
      webContentsForPartition: () =>
        tabWithCdp([{ name: 'sessionid_ls', value: 'SECRET-TOKEN', domain: '.x.com' }]),
      logger,
    });

    expect(JSON.stringify(logger.info.mock.calls)).not.toContain('SECRET-TOKEN');
  });
});
