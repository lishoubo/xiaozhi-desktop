/**
 * OTA tab 模块的公开面。外部只应通过 `OtaTabService` 打开 OTA 标签页；
 * `LoginDetector` 由 composition root 装配，不是给业务调用的。
 */
export { OtaTabService, type OtaTabServiceDependencies } from './ota-tab-service';
export { LoginDetector, type LoginDetectorDependencies } from './login-detector';

/**
 * 标签页事实广播。发射方只有本模块内的 `LoginDetector`；订阅方（如
 * `channels/hotel-probe-dispatcher.ts`）通过这个公开面拿到总线，不 import 具体
 * 文件路径。
 */
export {
  TabEventBus,
  type TabCredentialCheckedEvent,
  type CredentialCheckOutcome,
} from './tab-event-bus';

/** 打开意图：调用方构造，`LoginDetector` 保管，下游订阅者消费。 */
export type { OtaTabIntent, BindHotelIntent } from './intent';

/** 转出打开意图用到的环境类型，免得调用方为一个类型去 import 基础设施模块。 */
export type { PendingPartition } from '../file-store/partition-ledger';
