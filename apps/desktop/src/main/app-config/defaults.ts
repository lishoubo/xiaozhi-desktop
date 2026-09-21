/**
 * 内置默认值 —— 配置的**唯一真值兜底**。
 *
 * 任何一层覆盖都只能改这里的值，不能引入这里没有的键：`AppConfig` 是全量形状，
 * 缺键会让消费方拿到 `undefined`，而那种失效通常要到运行期才暴露。
 *
 * 每个值的依据写在 `types.ts` 的字段注释里，改默认值前先读那里。
 */
import { APP_ENVIRONMENT } from '../../shared/app-environment';
import type { AppConfig } from './types';

/**
 * 扫描节奏按环境分档。
 *
 * ```
 * dev           1 分钟 + [0,12s)    调试要快速看到下一轮，等 5 分钟没法迭代
 * pre / online  5 分钟 + [0,60s)    对账时效与渠道压力的平衡点
 * ```
 *
 * ⚠️ 抖动在**所有环境**都保留，不因 dev 就去掉：没有抖动，集中部署的门店会按各自启动
 * 时刻长期同相位，每 `idleMs` 齐刷刷打一次渠道 —— 正是触发风控的形状。dev 的抖动按
 * 同样的 20% 比例缩到 12 秒，不影响调试节奏。
 *
 * ⚠️ 这是**构建期**分档（`APP_ENVIRONMENT` 是编译期常量），不是运行期开关。理由见
 * `shared/app-environment.ts`：打包产物被双击启动时读不到父进程环境变量。
 */
const SCAN_PACE =
  APP_ENVIRONMENT === 'dev'
    ? { idleMs: 60_000, jitterMs: 12_000 }
    : { idleMs: 5 * 60_000, jitterMs: 60_000 };

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
    /**
     * 总闸。**dev 开，pre / online 关。**
     *
     * ⚠️ 正式环境默认关闭：周期性打渠道接口是有外部副作用的行为，不该因为装了新版本
     * 就自己跑起来。开启由服务端下发（配置形状已预留），不发版即可逐店灰度。
     *
     * dev 开着是为了让真机验证不必每次手改代码 —— 与 `SCAN_PACE` 同一分档手法。
     */
    enabled: APP_ENVIRONMENT === 'dev',
    // 15 天：与携程页面自然读一次返回的范围对齐（真机实测）。取 7 天的话，
    // 8~15 天那部分基线永远不会被比对，只占库。
    window: { kind: 'days', days: 15 },
    timeoutMs: 30_000,
    // 按环境分档，见上面的 SCAN_PACE。抖动恒为 idleMs 的 20% —— 比更新检查的 50% 小：
    // 那个是低频动作，散开 1 小时无所谓；扫描要保证对账时效，散太开会让
    // 「最坏多久发现一次变更」不可预期。
    idleMs: SCAN_PACE.idleMs,
    jitterMs: SCAN_PACE.jitterMs,
    // ⚠️ 未列出的渠道 = 关（接渠道是开发行为，必须显式开）。抖音尚未接入扫描。
    channels: { ctrip: { enabled: true }, meituan: { enabled: true } },
    // ⚠️ 未列出的酒店 = 取上层值（与 channels 相反）。默认不逐店配置，
    // 新绑的店跟随渠道开关，不会静默不扫。
    byHotel: {},
  },
};
