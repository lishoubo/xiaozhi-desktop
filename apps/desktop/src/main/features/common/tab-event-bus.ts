/**
 * 标签页导航后、登录判定结果确认后的广播总线。这里广播的是"这次导航，
 * ota-credential 层面该做的判定/归并（如果有的话）已经有结果了"这一个事实，
 * 连同判定结果本身一起广播——不是"URL变了"这种更早、更原始的时刻。
 *
 * 判定登录是否成功、credential 怎么归并，逻辑仍然只在
 * `main/features/ota-credential/` 里实现；这里只是把"判定/归并已经跑完，
 * 结果是这样"这个事实转发出去，不重新做任何业务判断。
 *
 * 为什么不在 did-navigate 那一刻就广播（见
 * openspec/changes/split-ota-hotel-prob-feature 后续修复记录）：credential
 * 的写入是异步的，如果广播时机早于写入完成，下游订阅者（如
 * `OtaHotelProbFeature`）查询 credential 会查到 null，永久错过这次探测
 * 机会——尤其在同一标签页只导航一次、没有第二次机会重试的场景下（如携程）。
 * 现在的时机保证：收到这个事件时，如果 outcome.kind 是 'checked'，
 * 对应的 credential（如果非 null）已经真实写入数据库，可以直接使用，
 * 不需要再查一次。
 *
 * 订阅方（如 `OtaHotelProbFeature`）自己决定要不要响应、响应什么——广播的是
 * 事实和结果，不是"你应该做什么"的指令。
 */
import { EventEmitter } from 'node:events';
import type { WebContents } from 'electron';
import type { OtaCredential } from '../../../domain/ota-credential';

export type CredentialCheckOutcome =
  | Readonly<{ kind: 'not-applicable' }>
  | Readonly<{ kind: 'not-yet-past-login' }>
  | Readonly<{ kind: 'checked'; credential: OtaCredential | null }>;

export type TabCredentialCheckedEvent = Readonly<{
  tabId: string;
  partitionName: string;
  channel: string;
  url: string;
  webContents: WebContents;
  outcome: CredentialCheckOutcome;
}>;

export class TabEventBus extends EventEmitter {
  emitCredentialChecked(event: TabCredentialCheckedEvent): void {
    this.emit('tab:credential-checked', event);
  }
}
