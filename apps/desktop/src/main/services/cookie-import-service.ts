/**
 * Cookie 导入的业务编排 —— 从宿主浏览器读出各渠道 Cookie，按渠道分别落盘。
 *
 * 这段逻辑原先直接写在 `ipc/browser-handlers.ts` 的 handler 里（约 30 行），
 * 无法脱离 IPC 单独测试。搬到这里之后 handler 只剩边界职责。
 */
import type { BrowserCookieSourceId, CookieImportResult } from '../../shared/browser';
import { DIAGNOSTICS_ENABLED } from '../../shared/diagnostics';
import {
  safeLogErrorDetails,
  type AppLogger,
  type SafeLogErrorDetails,
} from '../../shared/logging';
import type { BrowserCookieImporter } from '../cookie-import/browser-cookie-importer';
import { friendlyCookieImportMessage } from '../cookie-import/cookie-import';
import {
  listImportedChannels,
  writeImportedCookies,
  type ImportedChannelSummary,
} from '../cookie-import/store';

/** 转出给 ipc 层，免得 handler 为了一个类型去 import 基础设施模块。 */
export type { ImportedChannelSummary };

export type CookieImportServiceDependencies = Readonly<{
  importer: Pick<BrowserCookieImporter, 'listSources' | 'readCookies'>;
  userDataDir: string;
  logger: AppLogger;
}>;

/**
 * 把错误压成一行给界面看的诊断串：`Error: 消息 @ 抛出点`。
 *
 * 只取堆栈第一帧——内测同学是截图发过来的，整段堆栈既看不清也没必要；
 * 第一帧足以定位到具体哪一步失败。
 */
function diagnosticText(details: SafeLogErrorDetails): string {
  const frame = details.stack
    ?.split('\n')
    .slice(1)
    .map((line) => line.trim())
    .find((line) => line.startsWith('at '));
  const head = `${details.name}: ${details.message}`;
  const withCause = details.cause
    ? `${head} ← ${details.cause.name}: ${details.cause.message}`
    : head;
  return (frame ? `${withCause} @ ${frame}` : withCause).slice(0, 4_096);
}

export class CookieImportService {
  constructor(private readonly deps: CookieImportServiceDependencies) {}

  listSources(): ReturnType<BrowserCookieImporter['listSources']> {
    return this.deps.importer.listSources();
  }

  listImportedChannels(): Promise<readonly ImportedChannelSummary[]> {
    return listImportedChannels(this.deps.userDataDir);
  }

  /**
   * 失败不抛异常，而是把结果里的 `error` 填上友好文案 —— 导入 Cookie 是
   * 「尽力而为」的辅助操作，任何一个渠道读不到都不该让整个流程失败。
   */
  async import(sourceId: BrowserCookieSourceId): Promise<CookieImportResult> {
    try {
      const { cookiesByChannel, failed: readFailures } =
        await this.deps.importer.readCookies(sourceId);
      if (cookiesByChannel.size === 0 && readFailures === 0) {
        throw new Error('所选浏览器中没有找到可导入的 Cookie');
      }

      const importedAt = new Date().toISOString();
      await Promise.all(
        Array.from(cookiesByChannel.entries()).map(([channel, cookies]) =>
          writeImportedCookies(this.deps.userDataDir, channel, cookies, { importedAt, sourceId }),
        ),
      );

      const imported = Array.from(cookiesByChannel.values()).reduce(
        (total, cookies) => total + cookies.length,
        0,
      );
      if (imported === 0) throw new Error('未能导入 Cookie，请确认浏览器已登录并允许系统访问');

      this.deps.logger.info('Cookies imported to disk', {
        source: sourceId,
        channels: cookiesByChannel.size,
        imported,
        failed: readFailures,
      });
      return { imported, failed: readFailures };
    } catch (error) {
      const details = safeLogErrorDetails(error);
      this.deps.logger.warn('Cookie import could not be completed', {
        source: typeof sourceId === 'string' ? sourceId : 'unknown',
        error: details,
      });
      return {
        imported: 0,
        failed: 0,
        error: friendlyCookieImportMessage(error),
        ...(DIAGNOSTICS_ENABLED ? { diagnostic: diagnosticText(details) } : {}),
      };
    }
  }
}
