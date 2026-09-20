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
  meituanInventoryReadback: {
    // ⚠️ 刻意没有 delayMs / windowDays —— 美团写入同步、无「应用到所有日期」。见 types.ts。
    timeoutMs: 30_000,
  },
  inventoryScan: {
    // ⚠️ 默认关闭：有外部副作用的周期性行为不该因为装了新版本就自己跑起来。
    enabled: false,
    // 15 天：与携程页面自然读一次返回的范围对齐（真机实测）。取 7 天的话，
    // 8~15 天那部分基线永远不会被比对，只占库。
    window: { kind: 'days', days: 15 },
    timeoutMs: 30_000,
    idleMs: 5 * 60_000,
    // idleMs 的 20%。比更新检查的 50% 小：那个是低频动作，散开 1 小时无所谓；
    // 扫描要保证对账时效，散太开会让「最坏多久发现一次变更」不可预期。
    jitterMs: 60_000,
    quietAfterWriteMs: 60_000,
    // ⚠️ 未列出的渠道 = 关。美团/抖音未接入扫描，不在这里出现即不扫。
    channels: { ctrip: { enabled: true } },
    // ⚠️ 未列出的酒店 = 取上层值（与 channels 相反）。默认不逐店配置，
    // 新绑的店跟随渠道开关，不会静默不扫。
    byHotel: {},
  },
};
