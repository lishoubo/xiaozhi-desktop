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

/**
 * 房量回读的可调参数 —— **渠道无关，携程与美团共用一组**。
 *
 * ## ⚠️ 为什么合并成一组（原先是 ctrip / meituan 两组）
 *
 * 拆成两组的理由当时是「美团没有 delayMs / windowDays」。但那两项一个已删（`delayMs`
 * 全仓无消费方），另一个只是**携程独有的裁剪上限**而非通用回读参数 —— 剩下的部分渠道
 * 之间没有任何差异。两组配置里放同一个 30s 超时，只会让改的人不知道该改哪个。
 *
 * 将来某渠道真需要独有参数时，加一个 `channels: Record<string, ...>` 分组即可，
 * 不要再按渠道复制整组。
 */
export type InventoryReadbackConfig = Readonly<{
  /**
   * 「应用到所有日期」触发时的回读上限（天，从今日起算）。
   *
   * ## ⚠️ 这不是回读的常规范围
   *
   * 常规回读只读**用户实际改动过的那些日期**，不看这个值。它只在一个场景生效：
   * 用户在携程批量页勾选「应用到所有日期」。
   *
   * 那时携程会修改**从今日起约两年**的日期，并改变未显式设置过的日期的默认值 —— 这个
   * 集合客户端算不出来（要知道哪些日期被设置过，本身就得先有全量快照），也不可能回读
   * 两年。所以裁剪到这个窗口。
   *
   * ⚠️ 裁剪后上报的**不是完整快照**。服务端据 `rawRequest` 里保留的 `applyAllDates`
   * 字段自行处理。
   *
   * ⚠️ **当前只有携程消费**（美团没有「应用到所有日期」选项）。名字绑死场景是有意的 ——
   * 原名 `windowDays` 太宽泛，既与扫描窗口（`inventoryScan.windows.days`）重名，也容易
   * 被误用到常规回读上。
   */
  applyAllDatesReadbackDays: number;
}>;

/**
 * 价量态基线快照与定时扫描的可调参数。
 *
 * ## ⚠️ 本期（Change A）只有快照写入在用，`windows` 与超时是给 Change B 留的
 *
 * 形状先定下来，是因为改形状比改值贵得多：`windows` 的联合分支、`byHotel` 的深合并都会
 * 牵动 `mergeConfig`，而那是全局的。值可以随时改，形状定错了后面每加一项都要动结构。
 */
/**
 * 按渠道 / 按酒店可覆盖的那部分参数。开关与窗口都在这里 —— 两层用同一个形状，
 * 合并时逐层取值即可。
 */
export type InventoryScanScopeConfig = Readonly<{
  enabled: boolean;
  windows: Readonly<{ kind: 'days'; days: number }>;
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
   * ## ⚠️ 名字是复数，值**暂时仍是单段**
   *
   * 后续要支持多时间段（`[1.1-1.2, 3.1-3.10]` 这种）。名字先定成复数，是因为改名要动
   * 所有消费方，而改值的形状只动这里 —— 先把名字占住，下一个 change 再把类型换成
   * 数组并打通 dispatcher 与渠道层。
   *
   * ⚠️ **当前配多段是配不了的**（类型就是单个对象，不是数组）。不要在消费侧写
   * 「取第一段」这种兼容代码假装支持了 —— 那会让「配了第二段不生效」变成静默失效。
   *
   * ## ⚠️ 为什么是带 `kind` 的联合，而不是一个 `windowDays: number`
   *
   * 写成 `windowDays: number` 的话，支持多段时只能加一个并列的 `ranges?: [...]`，
   * 于是出现「两个字段都有值时听谁的」这种说不清的状态，且消费方漏判新字段时
   * **静默按旧字段跑**。
   *
   * 带 `kind` 的联合让扩展变成**加一个分支**，消费方的 `switch` 会被类型系统强制
   * 处理新分支 —— 漏了编译就过不去。
   */
  windows: Readonly<{ kind: 'days'; days: number }>;

  /**
   * 两轮之间歇多久（毫秒）。**默认按环境分档：dev 1 分钟，pre/online 5 分钟**
   * （见 `defaults.ts` 的 `SCAN_PACE`）。
   *
   * ⚠️ 是 fixed-delay 的「歇多久」，**不是固定频率**：上一轮完全结束后才开始计时，
   * 所以实际间隔 = 本轮耗时 + `idleMs` + 抖动，恒大于它。取名 `idleMs` 而非
   * `intervalMs` 正是为此 —— 后者会让人以为是「每 5 分钟一次」。
   */
  idleMs: number;

  /**
   * 随机抖动上限（毫秒）。**默认恒为 `idleMs` 的 20%**（dev 12 秒，pre/online 1 分钟）。
   * 每轮实际歇 `idleMs + [0, jitterMs)`。
   *
   * ⚠️ 不是可选项：没有抖动，同一批装机的机器（集中部署的门店）会按各自启动时刻形成
   * 固定节拍、长期同相位，每 `idleMs` 齐刷刷打一次渠道 —— 正是触发风控的形状。
   */
  jitterMs: number;

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
   * 酒店级开关与覆盖，键是 **`<channel>:<otaHotelId>`**（例：`ctrip:122247738`）。
   *
   * ⚠️ 键**必须带渠道前缀**：`otaHotelId` 取自各渠道自己的 `masterHotelId`，只在渠道内
   * 唯一，两个渠道完全可能出现相同数字 ID。用裸 ID 做键会让关掉一个渠道的某家店，
   * 连带关掉另一渠道同号的无关门店 —— 而这个开关存在的理由正是「只关那一个」。
   *
   * ⚠️ **未列出的酒店取上层的值**（与 `channels` 相反）—— 酒店是用户动态绑定的，
   * 要求每家店都显式登记才扫，会让新绑的店**静默不扫且没人发现**。
   *
   * 两处默认语义相反是有意的，不要「统一」成一种：统一成默认关 → 新店不扫；
   * 统一成默认开 → 新渠道没踩点就自动跑。
   */
  byHotel: Readonly<Record<string, Partial<InventoryScanScopeConfig>>>;
}>;

/**
 * 快照清理的可调参数。行为定义见 `inventory-snapshot/snapshot-cleaner.ts`。
 *
 * ## ⚠️ 为什么单独一组，而不是并进 `inventoryScan`
 *
 * 清理的确只清扫描写进去的那张表，但它与扫描是**两件相反的事**（一个写、一个删），
 * 放一组会让 `enabled` 的语义含糊：关掉扫描是否连清理也关？不该 —— 扫描关了，
 * 库里既有的旧数据仍然要被清掉，否则关闭扫描反而变成「停止清理」。
 */
export type SnapshotCleanupConfig = Readonly<{
  /**
   * 保留多少天以内的格子，更早的删掉（按 `item_date` 判定，不是写入时间）。
   *
   * ⚠️ 判据是**格子代表的日期**而非 `observed_at`：一条今天才抓到的、描述上周某天的
   * 记录，价值随那一天过去而消失，与什么时候抓到无关。
   */
  retentionDays: number;

  /**
   * 一批最多删多少行，删完让出事件循环。
   *
   * ⚠️ 不设上限会让积压久了的一次 DELETE 卡住主进程 —— better-sqlite3 是**同步** API，
   * 包 Promise 没用，唯一有效的是分批让出。手法与 `SnapshotWriteQueue` 一致。
   */
  batchSize: number;

  /**
   * 两轮清理之间歇多久（毫秒）。与扫描的 `idleMs` 同为 fixed-delay 语义。
   *
   * ⚠️ 需要定时而非只在启动时跑一次：桌面应用的常态是**常年不关**，只在启动时清理
   * 意味着这类机器永远不清。
   *
   * 不设抖动 —— 清理是纯本地动作，没有外部副作用，不存在扫描那种「集中部署的机器
   * 同相位打渠道」的风控问题。
   */
  idleMs: number;

  /**
   * 窗口就绪后等多久跑首轮（毫秒）。
   *
   * ⚠️ 不得改回 0 或挪回启动路径：原实现同步跑在 `createAppScope` 里（数据库刚打开、
   * 窗口还没创建），**这段卡多久窗口就晚出来多久**。
   */
  startupDelayMs: number;
}>;

export type AppConfig = Readonly<{
  /**
   * 单次渠道请求的超时（毫秒）—— **回读与扫描共用**。
   *
   * ⚠️ 顶层的标量，不属于任何分组：它描述的是「打渠道接口」这个动作本身，回读和扫描
   * 只是两个调用场景。原先回读两组、扫描一组各放一个 30s，改的人不知道该改哪个。
   *
   * ⚠️ `PartialAppConfig` 的形状是「分组 → 标量」两层，顶层标量的覆盖走
   * `mergeConfig` 的同名分支 —— 加顶层标量时看一眼那里，别假设它和分组一样处理。
   */
  requestTimeoutMs: number;
  inventoryReadback: InventoryReadbackConfig;
  inventoryScan: InventoryScanConfig;
  snapshotCleanup: SnapshotCleanupConfig;
}>;

/**
 * 配置的部分覆盖 —— 服务端下发与本地覆盖都用这个形状。
 *
 * 逐层深合并：某一层只给了部分键时，未给的键仍取下层的值，**不得变成 undefined**。
 *
 * ⚠️ **数组与联合类型的值是整体替换，不是逐元素合并。** 这是有意的：多时间段窗口
 * （`windows`）与将来的房型清单，语义都是「这一层说了算」，把两层的列表 concat
 * 起来会得到一个谁都没要求过的并集。改成 concat 之前先想清楚这一点。
 */
export type PartialAppConfig = {
  // ⚠️ 顶层标量（`requestTimeoutMs`）不能套 `Partial` —— `Partial<number>` 是个
  // 没有意义的类型，会让覆盖层写什么都通得过。分流成「对象才 Partial，标量原样」。
  readonly [K in keyof AppConfig]?: AppConfig[K] extends object
    ? Partial<AppConfig[K]>
    : AppConfig[K];
};

/** 配置来源。本期只有 `defaults` 真正实现，其余两个是预留形状。 */
export interface AppConfigSource {
  /** 这一层提供的覆盖；没有则返回 `null`（与「提供了一个空对象」区分开）。 */
  read(): PartialAppConfig | null;
}
