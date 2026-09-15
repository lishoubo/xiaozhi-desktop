import { z } from 'zod';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import type { ValidatedSubscribe } from '../invoke';

/**
 * 更新就绪通知没有 payload —— 界面只需要知道"有新版本装好了"，版本号之类的
 * 细节现在还用不上。主进程 `send` 不带参数，跨进程后就是 `undefined`。
 */
const updateReadyEventSchema = z.undefined();

/**
 * 自动更新在渲染进程侧只有一件事：收一条"已就绪"通知并提示用户。
 *
 * 没有反向调用——检查、下载、安装全程在主进程，界面不参与决策，也没有
 * "立即重启"的入口（安装发生在用户自然退出时，不打断正在做的事）。
 */
export function createUpdaterApi(subscribe: ValidatedSubscribe) {
  return Object.freeze({
    onUpdateReady: (listener: () => void) =>
      subscribe(updateReadyEventSchema, IPC_CHANNELS.updater.updateReady, () => listener()),
  });
}
