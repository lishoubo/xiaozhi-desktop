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

export type AppConfig = Readonly<{
  ctripInventoryReadback: CtripInventoryReadbackConfig;
  meituanInventoryReadback: MeituanInventoryReadbackConfig;
}>;

/**
 * 配置的部分覆盖 —— 服务端下发与本地覆盖都用这个形状。
 *
 * 逐层深合并：某一层只给了部分键时，未给的键仍取下层的值，**不得变成 undefined**。
 */
export type PartialAppConfig = {
  readonly [K in keyof AppConfig]?: Partial<AppConfig[K]>;
};

/** 配置来源。本期只有 `defaults` 真正实现，其余两个是预留形状。 */
export interface AppConfigSource {
  /** 这一层提供的覆盖；没有则返回 `null`（与「提供了一个空对象」区分开）。 */
  read(): PartialAppConfig | null;
}
