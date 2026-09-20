/**
 * 应用配置 —— **运行期可调**参数的统一落位。
 *
 * ## 与既有两类配置的区别
 *
 * ```
 * 构建期常量      __RMS_ORIGIN__ 等        Rollup 折叠成字面量，运行期改不了
 * 模块内私有常量  PENDING_MAX_AGE_MS 等    改了要重新发版
 * 本层            AppConfig                运行期可调，将来由服务端下发
 * ```
 *
 * ⚠️ **不得改成运行时读 `process.env`**。理由见 `staff-auth/rms-endpoint.ts` 的注释：
 * 打包产物是被双击启动的，父进程环境里没有那些变量，运行时读取会静默兜底到开发默认值，
 * 打出一个「看起来正常、却连着本机」的包。
 *
 * ## 为什么放在 `main/` 下与 `channels`/`services` 平级
 *
 * 它是**跨模块的基础设施**。放 `services/` 下则 `channels/` 够不着（eslint 分层禁令），
 * 而房量回读恰恰活在 `channels/` —— 各层通过**注入**拿到它，与既有 `report`/`notify`
 * 窄回调同一手法。
 *
 * ## 取值优先级
 *
 * ```
 * 内置默认值  →  服务端下发（缓存本地）  →  本地覆盖（调试）
 *   低                                              高
 * ```
 *
 * **本期只实现第一层**，其余两层只预留形状。服务端下发是完整链路（端点、缓存、失效、
 * 下发失败兜底、版本兼容），塞进本次会让房量回读本身的验证被配置链路的问题干扰。
 */

/** 携程房量回读的可调参数。行为定义见 `channels/ctrip/inventory-readback.ts`。 */
export type CtripInventoryReadbackConfig = Readonly<{
  /**
   * 改动被判定成功后，等多久再回读（毫秒）。
   *
   * **默认 `0`（不延迟）—— 这是留位，不是经验值。**
   *
   * ⚠️ 批量页的写接口是**异步**的（响应只给 `taskId` + 受理成功，不代表已写库），所以
   * 不延迟时**可能读到改动前的值**。这是第一期的已知取舍：先把链路跑通，避开定时器带来的
   * 整类复杂度（登记/清理、dispose 取消、延迟期间标签页被关）。
   *
   * 真机若确认读到旧值，改这个默认值即可，**不动代码结构**。
   */
  delayMs: number;

  /**
   * 「应用到所有日期」时的回读窗口（天，从今日起算）。
   *
   * 用户勾选该选项时携程会修改**从今日起约两年**的日期，并改变未显式设置过的日期的默认值
   * —— 这个集合客户端算不出来（要知道哪些日期被设置过，本身就得先有全量快照），也不可能
   * 回读两年。所以裁剪到这个窗口。
   *
   * ⚠️ 裁剪后上报的**不是完整快照**。服务端据 `rawRequest` 里保留的 `applyAllDates`
   * 字段自行处理。
   */
  windowDays: number;

  /** 单次回读请求的超时（毫秒）。沿用 `rms-rpa-worker` 侧 `inventory.py` 的口径。 */
  timeoutMs: number;
}>;

/**
 * 美团房量回读的可调参数。行为定义见 `channels/meituan/inventory-readback.ts`。
 *
 * ## ⚠️ 为什么**只有** `timeoutMs` —— 不要照携程补另外两项
 *
 * | 携程有 | 美团为何没有 |
 * |---|---|
 * | `delayMs` | 美团写接口是**同步**的（用户确认）。携程那个是为异步批量页留的位，而美团页面保存后**不发任何任务轮询请求**，连门控对象都没有。留一个永远取 0 的旋钮，会让后来者以为这里存在异步风险。 |
 * | `windowDays` | 美团**没有**「应用到所有日期」选项，不存在需要裁剪的无界范围，`truncated` 恒 `false`。 |
 *
 * 真机若发现读到旧值 —— 那是决策 1.2 的前提被推翻，应回到 design 重新设计门控，
 * **不是**在这里加一个延迟绕过去。
 */
export type MeituanInventoryReadbackConfig = Readonly<{
  /** 单次回读请求的超时（毫秒）。沿用携程同项的口径。 */
  timeoutMs: number;
}>;

/**
 * 价量态基线快照与定时扫描的可调参数。
 *
 * ## ⚠️ 本期（Change A）只有快照写入在用，`window` 与 `timeoutMs` 是给 Change B 留的
 *
 * 形状先定下来，是因为改形状比改值贵得多：`window` 的联合分支、`byHotel` 的深合并都会
 * 牵动 `mergeConfig`，而那是全局的。值可以随时改，形状定错了后面每加一项都要动结构。
 */
/**
 * 按渠道 / 按酒店可覆盖的那部分参数。开关与窗口都在这里 —— 两层用同一个形状，
 * 合并时逐层取值即可。
 */
export type InventoryScanScopeConfig = Readonly<{
  enabled: boolean;
  window: Readonly<{ kind: 'days'; days: number }>;
}>;

/**
 * 价量态定时扫描的可调参数。行为定义见 `channels/inventory-scan-dispatcher.ts`。
 *
 * ## ⚠️ 三层开关，逐层与，任一层关即不扫
 *
 * ```
 * enabled                      总闸
 *   └─ channels[source]          渠道级
 *        └─ byHotel[otaHotelId]   酒店级
 * ```
 *
 * 周期性打渠道接口**有外部副作用**，必须能按最小粒度关停：某家店触发风控、某个渠道
 * 改版导致取数异常时，要能只关那一个，而不是整个功能下线或重新发版。
 */
export type InventoryScanConfig = Readonly<{
  /**
   * 总闸。⚠️ **默认 `false`** —— 有外部副作用的周期性行为不该因为装了新版本就
   * 自己跑起来。
   */
  enabled: boolean;

  /**
   * 日期窗口 —— 扫描覆盖从今天起的哪些天。
   *
   * ## ⚠️ 为什么是带 `kind` 的联合，而不是一个 `windowDays: number`
   *
   * 后续要支持多时间段（`[1.1-1.2, 3.1-3.10]` 这种）。若现在写成 `windowDays: number`，
   * 那时只能加一个并列的 `ranges?: [...]`，于是出现「两个字段都有值时听谁的」这种
   * 说不清的状态，且消费方漏判新字段时**静默按旧字段跑**。
   *
   * 带 `kind` 的联合让扩展变成**加一个分支**，消费方的 `switch` 会被类型系统强制
   * 处理新分支 —— 漏了编译就过不去。
   */
  window: Readonly<{ kind: 'days'; days: number }>;

  /** 单次取数请求的超时（毫秒）。沿用回读同项的口径。 */
  timeoutMs: number;

  /**
   * 两轮之间歇多久（毫秒）。**默认 5 分钟。**
   *
   * ⚠️ 是 fixed-delay 的「歇多久」，**不是固定频率**：上一轮完全结束后才开始计时，
   * 所以实际间隔 = 本轮耗时 + `idleMs` + 抖动，恒大于它。取名 `idleMs` 而非
   * `intervalMs` 正是为此 —— 后者会让人以为是「每 5 分钟一次」。
   */
  idleMs: number;

  /**
   * 随机抖动上限（毫秒）。**默认 1 分钟**（`idleMs` 的 20%）。
   * 每轮实际歇 `idleMs + [0, jitterMs)`。
   *
   * ⚠️ 不是可选项：没有抖动，同一批装机的机器（集中部署的门店）会按各自启动时刻形成
   * 固定节拍、长期同相位，每 `idleMs` 齐刷刷打一次渠道 —— 正是触发风控的形状。
   */
  jitterMs: number;

  /**
   * 距上次用户写操作不足这个毫秒数则跳过本轮。默认 1 分钟。
   *
   * 用户正在改价时扫描，取到的可能是改了一半的中间态，且与回读抢同一批数据。
   */
  quietAfterWriteMs: number;

  /**
   * 渠道级开关与覆盖。
   *
   * ⚠️ **未列出的渠道视为关闭**（不是默认开）—— 渠道是有限且已知的，接一个渠道是
   * 开发行为，必须显式开；新接入的渠道在踩点完成前不该被自动扫描。
   *
   * ⚠️ 与 `byHotel` 的默认语义**刻意相反**，见那边的注释。
   */
  channels: Readonly<Record<string, Partial<InventoryScanScopeConfig>>>;

  /**
   * 酒店级开关与覆盖，键是 `otaHotelId`。
   *
   * ⚠️ **未列出的酒店取上层的值**（与 `channels` 相反）—— 酒店是用户动态绑定的，
   * 要求每家店都显式登记才扫，会让新绑的店**静默不扫且没人发现**。
   *
   * 两处默认语义相反是有意的，不要「统一」成一种：统一成默认关 → 新店不扫；
   * 统一成默认开 → 新渠道没踩点就自动跑。
   */
  byHotel: Readonly<Record<string, Partial<InventoryScanScopeConfig>>>;
}>;

export type AppConfig = Readonly<{
  ctripInventoryReadback: CtripInventoryReadbackConfig;
  meituanInventoryReadback: MeituanInventoryReadbackConfig;
  inventoryScan: InventoryScanConfig;
}>;

/**
 * 配置的部分覆盖 —— 服务端下发与本地覆盖都用这个形状。
 *
 * 逐层深合并：某一层只给了部分键时，未给的键仍取下层的值，**不得变成 undefined**。
 *
 * ⚠️ **数组与联合类型的值是整体替换，不是逐元素合并。** 这是有意的：多时间段窗口
 * （`window.ranges`）与将来的房型清单，语义都是「这一层说了算」，把两层的列表 concat
 * 起来会得到一个谁都没要求过的并集。改成 concat 之前先想清楚这一点。
 */
export type PartialAppConfig = {
  readonly [K in keyof AppConfig]?: Partial<AppConfig[K]>;
};

/** 配置来源。本期只有 `defaults` 真正实现，其余两个是预留形状。 */
export interface AppConfigSource {
  /** 这一层提供的覆盖；没有则返回 `null`（与「提供了一个空对象」区分开）。 */
  read(): PartialAppConfig | null;
}
