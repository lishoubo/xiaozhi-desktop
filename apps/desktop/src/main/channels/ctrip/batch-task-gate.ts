/**
 * 携程**批量任务**的完成门控 —— 等渠道真的写完了再回读。
 *
 * ## 为什么需要它
 *
 * 批量页（`batchSetRoomStatusAndQuantity`）的写接口是**异步**的：响应只给
 * `{ taskId, resStatus: { rcode: 200 } }`，`rcode: 200` 只代表**受理**，不代表已写库。
 *
 * 2026-09-18 真机实测坐实了这一点：用户把 2 个房型 3 天设成限量 19，改完立即回读拿到的是
 * `21 / 2 / 2`（**改前**的值），而页面刷新后显示的是 19。
 *
 * ⚠️ 这个错误**无法靠比对值来发现** —— 「增加 / 减少」是相对操作，不知道基数，读到 21
 * 无从判断是改前还是改后。所以不能靠「读到旧值就重试」收敛，必须知道渠道什么时候写完。
 *
 * ## 机制：不自己查，拦页面自己的轮询
 *
 * 页面保存后会自己轮询 `queryMainTaskInfoForDisplay` 直到任务完成。我们**拦这个响应**，
 * 而不是自己去查。
 *
 * ⚠️ 自己查这条路走不通：该端点带 `spidertoken`（~1500 字符）和 `w-payload-source`，
 * **每次都变、本地无法构造**，请求体还要 `cipher`（对 taskId 的签名）。而回读用的那两个
 * 接口（`getRcProductList` / `getRoomInventoryInfo`）是纯 cookie 无签名的，两者不可混为
 * 一谈。拦截页面自己的请求则完全绕开签名问题。
 *
 * ```
 * 保存 → 响应 { taskId }          ← 记下 taskId，回读挂起
 *          ↓
 * 页面自己轮询 queryMainTaskInfoForDisplay
 *          ↓  拦到 status: SUCCESS 且 taskId 匹配
 *        回读
 * ```
 *
 * ## ⚠️ 超时必须放弃，不能「超时了也回读」
 *
 * 等不到完成说明我们**不知道渠道写完没有**，此时回读拿到的值同样无法判断新旧 —— 与不等
 * 是一样的处境。宁可不报，也不报一份可能是旧值的数据（那会让服务端照着跟错价）。
 */
import type { AppLogger } from '../../../shared/logging';
import type { JsonObject } from '../../../shared/types/json';

/** 查询任务状态的端点。页面保存后自己轮询它。 */
export const CTRIP_TASK_QUERY_ENDPOINT_ID = 'queryMainTaskInfoForDisplay';
export const CTRIP_TASK_QUERY_PATH = '/queryMainTaskInfoForDisplay';

/**
 * 已证实的任务状态取值：`CREATING`（进行中）、`SUCCESS`（完成）。
 *
 * ⚠️ 失败态**没有样本**。所以判据取「**只有明确 SUCCESS 才放行**」，而不是「不是 CREATING
 * 就放行」—— 后者会把未知的失败态当成成功，回读到一份没真正生效的数据。
 */
const TASK_STATUS_SUCCESS = 'SUCCESS';

/** 等待任务完成的上限。超过即放弃本次回读（见文件头）。 */
const DEFAULT_TASK_TIMEOUT_MS = 30_000;

/** `completed` 的容量上限，兜底防泄漏。见 `evictStaleCompleted`。 */
const COMPLETED_MAX_ENTRIES = 64;

type Waiter = Readonly<{
  resolve: (completed: boolean) => void;
  timer: NodeJS.Timeout;
}>;

/**
 * 从批量页写请求的**响应体**里取 `taskId`。
 *
 * 形状：`{ taskId, resStatus: { rcode: 200 }, ResponseStatus: {...} }`，`taskId` 在顶层。
 * 取不到返回 `null` —— 调用方据此判定「这次不是异步任务」，走同步路径。
 */
export function taskIdOfSaveResponse(responseBody: string): string | null {
  try {
    const parsed: unknown = JSON.parse(responseBody);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const taskId = (parsed as JsonObject).taskId;
    return typeof taskId === 'string' && taskId.length > 0 ? taskId : null;
  } catch {
    return null;
  }
}

/**
 * 从任务查询的响应体里取 `(taskId, status)`。
 *
 * 形状：`{ mainTaskInfoForDisplayInfo: { taskId, status, ... }, resStatus: {...} }`。
 * ⚠️ `taskId` 在**嵌套**的 `mainTaskInfoForDisplayInfo` 里，与写响应的顶层位置不同。
 */
export function taskStatusOfQueryResponse(
  responseBody: string,
): Readonly<{ taskId: string; status: string }> | null {
  try {
    const parsed: unknown = JSON.parse(responseBody);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const info = (parsed as JsonObject).mainTaskInfoForDisplayInfo;
    if (typeof info !== 'object' || info === null || Array.isArray(info)) return null;
    const { taskId, status } = info as JsonObject;
    if (typeof taskId !== 'string' || typeof status !== 'string') return null;
    return { taskId, status };
  } catch {
    return null;
  }
}

/**
 * 按 `taskId` 等待批量任务完成。
 *
 * ## 为什么可以是渠道级单例
 *
 * 「适配器必须无状态、否则多标签页会串数据」这条约束在这里**不适用**：本类的状态全部按
 * `taskId` 分键，而 `taskId` 是携程生成的全局唯一值（形如
 * `057a470b-...-4c4cceeb3bd0_202609`）。两个标签页各自保存产生的是两个不同的 taskId，
 * 各等各的，不存在串的可能。
 *
 * 这也是它能被**适配器（喂查询响应）与回读实现（等待完成）共同访问**的前提 —— 两者分处
 * 不同的调用链，用 taskId 当汇合点比在机制层传递一个它不理解的状态对象要简单得多。
 */
export class CtripBatchTaskGate {
  private readonly waiters = new Map<string, Waiter>();
  /** 端点 → 最近一次的 taskId。见 `rememberTask`。 */
  private readonly lastTaskByEndpoint = new Map<string, string>();
  /**
   * 已经收到过 SUCCESS 的 taskId。
   *
   * ⚠️ **必须有**：`waitFor` 不一定先于 SUCCESS 到达 —— 回读侧要先走完既有上报链路
   * （查 /me、查凭证、POST 上报，实测约 400ms）才调 `waitFor`，而页面轮询是并行的。
   * 没有这张表的话，先到的 SUCCESS 会因「没人在等」被丢弃，随后 `waitFor` 一路等到超时，
   * 表现为**批量页永远回读不到** —— 而日志上只有一条超时 warn，看不出是竞态。
   */
  private readonly completed = new Set<string>();

  constructor(
    private logger: AppLogger,
    private readonly timeoutMs: number = DEFAULT_TASK_TIMEOUT_MS,
  ) {}

  /** 见文件末尾单例的说明。 */
  setLogger(logger: AppLogger): void {
    this.logger = logger;
  }

  /**
   * 登记「这个端点刚发起了一个异步任务」。
   *
   * 由适配器在判定保存成功时调用 —— 那里是**唯一**能同时看到 `endpointId` 与响应体
   * （`taskId` 在其中）的地方。回读侧拿到的 `OtaAmountChangeObserved` 已经不含响应体了。
   *
   * 按 `endpointId` 记而不是按标签页：紧接着的回读一定是同一次改动触发的，中间没有别的
   * 保存能插进来（用户点一次保存 → 一次上报 → 一次回读，串行）。
   */
  rememberTask(endpointId: string, responseBody: string): void {
    const taskId = taskIdOfSaveResponse(responseBody);
    if (taskId === null) return;
    this.lastTaskByEndpoint.set(endpointId, taskId);
  }

  /** 取出并**消费掉**该端点最近一次的 taskId。没有则返回 `null`（说明不是异步任务）。 */
  takeTask(endpointId: string): string | null {
    const taskId = this.lastTaskByEndpoint.get(endpointId) ?? null;
    this.lastTaskByEndpoint.delete(endpointId);
    return taskId;
  }

  /**
   * 等这个任务完成。
   *
   * @returns `true` = 已完成（可以回读）；`false` = 超时放弃
   */
  async waitFor(taskId: string): Promise<boolean> {
    // SUCCESS 已经先到了（见 `completed` 的注释）—— 直接放行，不必再等。
    if (this.completed.delete(taskId)) return true;

    // 同一个 taskId 重复等待理论上不会发生（一次保存一个 taskId）。真出现时让前一个
    // 以「未完成」结束，避免它被永久挂起 —— 静默泄漏比多一次放弃更难查。
    this.settle(taskId, false);

    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.waiters.delete(taskId);
        this.logger.warn('Ctrip batch task did not complete in time, skipping readback', {
          taskId,
          timeoutMs: this.timeoutMs,
        });
        resolve(false);
      }, this.timeoutMs);

      this.waiters.set(taskId, { resolve, timer });
    });
  }

  /**
   * 喂一条任务查询的响应。拦到的每一条都该喂进来，与本实例无关的会被忽略。
   *
   * 只有**明确 `SUCCESS`** 才放行；`CREATING` 与任何未知状态都继续等（等不到就超时放弃）。
   */
  onTaskQueried(responseBody: string): void {
    const parsed = taskStatusOfQueryResponse(responseBody);
    if (!parsed) return;

    if (parsed.status !== TASK_STATUS_SUCCESS) {
      // CREATING 是正常的中间态，不记日志（页面会高频轮询，记了就是刷屏）。
      return;
    }

    this.logger.info('Ctrip batch task completed', { taskId: parsed.taskId });
    if (this.waiters.has(parsed.taskId)) {
      this.settle(parsed.taskId, true);
      return;
    }
    // 还没有人在等 —— 记下来，`waitFor` 来了直接放行。
    this.completed.add(parsed.taskId);
    this.evictStaleCompleted();
  }

  /**
   * `completed` 的兜底清理：正常流程里每一项都会被 `waitFor` 取走，但「保存成功了却没触发
   * 回读」的路径（房型取不到、用户关页面）会留下孤儿项。不清会随使用无限增长。
   */
  private evictStaleCompleted(): void {
    if (this.completed.size <= COMPLETED_MAX_ENTRIES) return;
    // Set 保持插入序，删最早的那些。
    const excess = this.completed.size - COMPLETED_MAX_ENTRIES;
    let removed = 0;
    for (const taskId of this.completed) {
      if (removed >= excess) break;
      this.completed.delete(taskId);
      removed += 1;
    }
  }

  /** 页面会话结束。所有还在等的一律以「未完成」收场，清掉定时器。 */
  dispose(): void {
    for (const taskId of [...this.waiters.keys()]) {
      this.settle(taskId, false);
    }
    this.completed.clear();
    this.lastTaskByEndpoint.clear();
  }

  private settle(taskId: string, completed: boolean): void {
    const waiter = this.waiters.get(taskId);
    if (!waiter) return;
    this.waiters.delete(taskId);
    clearTimeout(waiter.timer);
    waiter.resolve(completed);
  }
}

/**
 * 渠道级单例 —— 适配器（喂查询响应）与回读实现（等待完成）分处两条调用链，用它当汇合点。
 *
 * 单例安全的理由见 `CtripBatchTaskGate` 的类注释：状态全部按全局唯一的 `taskId` 分键。
 *
 * logger 用 `setLogger` 后注入而不是构造注入：本模块被 import 时就要能用，而 logger 要到
 * `createChannelRegistry` 才有。未注入时静默丢日志，不影响功能。
 */
export const ctripBatchTaskGate = new CtripBatchTaskGate({
  info: () => {},
  warn: () => {},
  error: () => {},
});
