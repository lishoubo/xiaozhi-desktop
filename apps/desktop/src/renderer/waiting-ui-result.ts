/**
 * 「UI 在等一个异步结果」的等待表。
 *
 * 有些流程由 UI 发起、在主进程异步跑完，结果经事件通道回来而不是 invoke 的返回
 * 值（如酒店绑定：发起 → 开标签页 → 用户登录 → 探测 → 候选）。这类流程不能用
 * Promise 表达——探测可能永不发生，Promise 会永久挂起。
 *
 * 等待表放在这里而不是主进程：它随组件卸载自然消亡，用户关窗、切页、放弃都不需
 * 要通知主进程做任何清理。主进程全程不知道「有人在等」。
 */
import type {
  UiWaitingResultEnvelope,
  UiWaitingResultKind,
  UiWaitingResultPayloads,
} from '../shared/types/ui-waiting-result-types';

export type WaitingUiResult = Readonly<{
  /** 登记等待，返回取消函数——组件卸载或用户放弃时调用。 */
  await<K extends UiWaitingResultKind>(
    kind: K,
    requestId: string,
    onResult: (payload: UiWaitingResultPayloads[K]) => void,
  ): () => void;
  dispose(): void;
}>;

export function createWaitingUiResult(
  subscribe: (listener: (envelope: UiWaitingResultEnvelope) => void) => () => void,
  /** 信封到了却没人在等——调用方可据此排查（本模块不依赖任何日志实现）。 */
  onUnclaimed?: (envelope: UiWaitingResultEnvelope, waitingCount: number) => void,
): WaitingUiResult {
  // 异构 Map：不同 kind 的回调 payload 类型不同，TS 表达不了这种关系。两处
  // `as never` 是代价，收在本文件内——对外的 `await<K>` 完全类型安全，调用方
  // 拿到的 payload 会按 kind 自动收窄。
  const waiting = new Map<string, (payload: never) => void>();

  const unsubscribe = subscribe((envelope) => {
    const resolve = waiting.get(envelope.requestId);
    if (!resolve) {
      // 不是本页在等的，或用户已放弃
      onUnclaimed?.(envelope, waiting.size);
      return;
    }
    waiting.delete(envelope.requestId);
    resolve(envelope.payload as never);
  });

  return {
    await(kind, requestId, onResult) {
      // kind 只用于给 onResult 定类型；认领靠全局唯一的 requestId。
      void kind;
      waiting.set(requestId, onResult as (payload: never) => void);
      return () => waiting.delete(requestId);
    },
    dispose: unsubscribe,
  };
}
