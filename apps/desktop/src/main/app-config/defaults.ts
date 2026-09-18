/**
 * 内置默认值 —— 配置的**唯一真值兜底**。
 *
 * 任何一层覆盖都只能改这里的值，不能引入这里没有的键：`AppConfig` 是全量形状，
 * 缺键会让消费方拿到 `undefined`，而那种失效通常要到运行期才暴露。
 *
 * 每个值的依据写在 `types.ts` 的字段注释里，改默认值前先读那里。
 */
import type { AppConfig } from './types';

export const DEFAULT_APP_CONFIG: AppConfig = {
  ctripInventoryReadback: {
    // 留位，不是经验值 —— 第一期不延迟，真机确认读到旧值后再调。见 types.ts。
    delayMs: 0,
    windowDays: 7,
    timeoutMs: 30_000,
  },
};
