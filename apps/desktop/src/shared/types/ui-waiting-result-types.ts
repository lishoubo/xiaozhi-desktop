/**
 * 「UI 在等一个异步结果」的跨进程契约。
 *
 * 有些流程由 UI 发起、在主进程异步跑完、结果要回到发起方，但中间可能经过事件
 * 总线而非函数返回（如酒店绑定：发起 → 开标签页 → 导航 → 探测 → 候选）。这类
 * 流程不能用一次 invoke 的返回值表达——探测可能永不发生，Promise 会永久挂起。
 *
 * 形状是「发起时拿 requestId → 登记等待 → 结果带同一个 requestId 回来」。
 * 等待表放在 renderer（随组件消亡），主进程不为「有人在等」保存任何状态。
 *
 * 新增一种等待结果只改这里的映射表：kind 与 payload 焊死，调用方拿到的 payload
 * 类型自动收窄，写错字段编译期即报错。
 */
import type { JsonObject } from './json';

/** 探测出的候选酒店（跨进程形状，尚未保存）。 */
export type ProbedHotelDto = Readonly<{
  otaHotelId: string;
  otaHotelName: string | null;
  bindExtra: JsonObject | null;
}>;

/** kind → payload 的唯一事实来源。 */
export type UiWaitingResultPayloads = {
  'bind-hotel': Readonly<{
    credentialId: string;
    hotels: readonly ProbedHotelDto[];
  }>;
};

export type UiWaitingResultKind = keyof UiWaitingResultPayloads;

export type UiWaitingResultEnvelope<K extends UiWaitingResultKind = UiWaitingResultKind> =
  Readonly<{
    requestId: string;
    kind: K;
    payload: UiWaitingResultPayloads[K];
  }>;
