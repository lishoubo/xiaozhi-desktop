import { z } from 'zod';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { manualUpdateSchema, type ManualUpdate } from '../../shared/updater';
import type { ValidatedSubscribe } from '../invoke';

/**
 * 更新就绪通知没有 payload —— 界面只需要知道"有新版本装好了"，版本号之类的
 * 细节现在还用不上。主进程 `send` 不带参数，跨进程后就是 `undefined`。
 */
const updateReadyEventSchema = z.undefined();

/**
 * 更新在渲染进程侧只有两条通知，按平台二选一：
 *
 * ```
 * Windows  onUpdateReady    已静默下载好，退出时自动装
 * 其他      onManualUpdate   有新版本，但要用户自己去下载
 * ```
 *
 * 没有反向调用——检查、下载、安装全程在主进程，界面不参与决策，也没有
 * "立即重启"的入口（安装发生在用户自然退出时，不打断正在做的事）。
 */
export function createUpdaterApi(subscribe: ValidatedSubscribe) {
  return Object.freeze({
    onUpdateReady: (listener: () => void) =>
      subscribe(updateReadyEventSchema, IPC_CHANNELS.updater.updateReady, () => listener()),
    onManualUpdate: (listener: (update: ManualUpdate) => void) =>
      subscribe(manualUpdateSchema, IPC_CHANNELS.updater.manualUpdateAvailable, listener),
  });
}
