/**
 * 上报能力的**窄接口**，与实现分离。
 *
 * ## 为什么单独一个文件
 *
 * 实现（`report-error.ts`）import 了 Sentry SDK，而 SDK 会拉进 `electron`。若各层
 * 从实现文件里取类型，`gateway/`、`services/` 这些本可纯逻辑单测的层就被迫加载整个
 * Electron —— 实测就是这么炸的（`does not provide an export named 'app'`）。
 *
 * 类型与 noop 放这里，实现放隔壁：调用方按接口编程，只有 composition root 碰实现。
 * 与 `AppLogger` 的处理方式一致。
 */
import type { JsonObject } from '../../shared/types/json';

/**
 * 随错误一起上报的定位信息。**只放能用来定位的标识，不放业务内容**——
 * 上报体里多一个字段就多一份外泄面，`beforeSend` 的脱敏是兜底不是许可。
 */
export type ErrorReportContext = Readonly<{
  /** 出事的操作，如 `reportAmountChange`。用于在 GlitchTip 里按操作聚合。 */
  operation: string;
  /** 渠道：meituan / ctrip / douyin。 */
  channel?: string;
  /** 酒店 ID —— 运营按门店排查的主要维度。 */
  hotelId?: string;
  /** 其余定位字段，会被 `beforeSend` 一并脱敏。 */
  extra?: JsonObject;
}>;

export type ErrorReporter = (error: unknown, context: ErrorReportContext) => void;

/** 单测与未配置上报时用的空实现。 */
export const noopErrorReporter: ErrorReporter = () => {};
