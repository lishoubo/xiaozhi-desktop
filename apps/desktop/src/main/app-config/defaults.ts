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
 * 扫描节奏 —— **所有环境统一 5 分钟 + [0,60s) 抖动**。
 *
 * 曾按环境分档（dev 1 分钟），理由是「调试要快速看到下一轮」。实测下来 dev 也用
 * 5 分钟即可，于是分档取消 —— 两档取同一组值时，那个三元判断就只是让人以为
 * 存在差异。
 *
 * ⚠️ 抖动不可去掉：没有抖动，集中部署的门店会按各自启动时刻长期同相位，每 `idleMs`
 * 齐刷刷打一次渠道 —— 正是触发风控的形状。恒为 `idleMs` 的 20%。
 *
 * ⚠️ 要临时调快调试节奏，改这里的值重新构建，**不要改回运行期读环境变量**。理由见
 * `shared/app-environment.ts`：打包产物被双击启动时读不到父进程环境变量。
 */
const SCAN_PACE = { idleMs: 5 * 60_000, jitterMs: 60_000 };

export const DEFAULT_APP_CONFIG: AppConfig = {
  // 回读与扫描共用。30s 沿用 `rms-rpa-worker` 侧 `inventory.py` 的口径。
  requestTimeoutMs: 30_000,
  inventoryReadback: {
    // 只在携程「应用到所有日期」时生效 —— 常规回读读的是用户实际改动的日期。见 types.ts。
    applyAllDatesReadbackDays: 7,
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
    windows: { kind: 'days', days: 15 },
    // 见上面的 SCAN_PACE。抖动恒为 idleMs 的 20% —— 比更新检查的 50% 小：
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
  snapshotCleanup: {
    // 3 天：扫描窗口 15 天写进来的格子，过了自己代表的那天就没有对账价值了。
    // 比窗口短是对的 —— 留的是「刚过去的几天」，不是「扫过的所有天」。
    retentionDays: 3,
    // 一批 500 行。与写入队列的 200 不同量级：删除比 upsert 轻，且清理是低频动作，
    // 批大一点少让出几次；真积压了也不会一次卡住。
    batchSize: 500,
    // 6 小时一轮。过期按天发生，一天跑几次绰绰有余；取 6h 而非 24h 是为了让
    // 「开着不关的机器」在一天内多几次机会，不必卡在某个整点。
    idleMs: 6 * 60 * 60_000,
    // 窗口就绪后等 30 秒再跑首轮 —— 让启动阶段的 IPC、页面加载先过去。
    startupDelayMs: 30_000,
  },
};
