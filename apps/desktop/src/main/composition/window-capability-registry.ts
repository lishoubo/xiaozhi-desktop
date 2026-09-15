import type { ChannelId } from '../ids';

/** 架构约束：不 import `browser/` 实现，用类型查询表达结构依赖。 */
type WebContents = import('electron').WebContents;

export type WindowCapabilities = Readonly<{
  retirePartition(partitionName: string): Promise<void>;
  notifyAccountBound(channel: ChannelId): void;
  /**
   * 按 partition 反查标签页 webContents —— cookie 快照采集走 CDP 时需要它。
   *
   * 放在窗口能力里而不是进程级：标签页由窗口级的 `BrowserManager` 持有，而采集
   * 入口（`readCookieSnapshot`）是进程级的。窗口不存在时调用方按「没有标签页」
   * 降级，不抛错 —— 这与用户提前关掉标签页是同一种情况。
   */
  webContentsForPartition(partitionName: string): WebContents | null;
  /**
   * 新版本已就绪，提示用户重启。
   *
   * ⚠️ 调用方必须走 `current()` 而非 `requireCurrent()`：下载在后台进行，完成时
   * 用户可能已经关掉窗口。此时提示送不到是正常的——更新照样会在退出时装上，
   * 下次启动就是新版本。
   */
  notifyUpdateReady(): void;
}>;

export type WindowCapabilityRegistration = Readonly<{
  dispose(): void;
}>;

export type WindowCapabilityRegistry = Readonly<{
  attach(capabilities: WindowCapabilities): WindowCapabilityRegistration;
  current(): WindowCapabilities | null;
  requireCurrent(): WindowCapabilities;
}>;

export function createWindowCapabilityRegistry(): WindowCapabilityRegistry {
  let attached: WindowCapabilities | null = null;

  return {
    attach(capabilities) {
      if (attached) throw new Error('Window capabilities are already attached');
      attached = capabilities;
      let disposed = false;
      return {
        dispose() {
          if (disposed) return;
          disposed = true;
          if (attached === capabilities) attached = null;
        },
      };
    },
    current() {
      return attached;
    },
    requireCurrent() {
      if (!attached) throw new Error('Window capabilities are unavailable');
      return attached;
    },
  };
}
