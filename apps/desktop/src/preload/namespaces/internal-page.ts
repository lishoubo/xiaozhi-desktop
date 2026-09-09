import { browserTabSchema } from '../../shared/browser';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import type { ValidatedInvoke } from '../invoke';

export function createInternalPageApi(invoke: ValidatedInvoke) {
  return Object.freeze({
    /**
     * 打开统一改价页。**不收任何参数** —— 令牌由主进程取（渲染进程从来拿不到令牌），
     * 酒店由服务端定（desktop 不维护「当前酒店」）。
     *
     * 已经开着时复用那个标签页，不叠开。
     */
    open: () => invoke(browserTabSchema, IPC_CHANNELS.internalPage.open),
  });
}
