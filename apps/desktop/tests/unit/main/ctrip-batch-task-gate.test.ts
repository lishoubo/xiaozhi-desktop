import { describe, expect, it, vi } from 'vitest';
import {
  CtripBatchTaskGate,
  taskIdOfSaveResponse,
  taskStatusOfQueryResponse,
} from '../../../src/main/channels/ctrip/batch-task-gate';

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

const TASK_ID = '057a470b-a04d-43db-8c3f-4c4cceeb3bd0_202609';

/** 批量页保存的真实响应（`房态房量菜单.md`）。 */
const SAVE_RESPONSE = JSON.stringify({
  taskId: TASK_ID,
  resStatus: { rcode: 200, rmsg: '' },
  ResponseStatus: { Ack: 'Success', Errors: [] },
});

/** 任务查询的真实响应（`批量任务查询.md`）。 */
function queryResponse(status: string, taskId = TASK_ID): string {
  return JSON.stringify({
    ResponseStatus: { Ack: 'Success', Errors: [] },
    mainTaskInfoForDisplayInfo: {
      taskId,
      status,
      operationType: 'RC_BATCH_SET_STATUS_AND_QUANTITY',
    },
    resStatus: { rcode: 200, rmsg: '' },
  });
}

describe('taskIdOfSaveResponse', () => {
  it('从写响应顶层取 taskId', () => {
    expect(taskIdOfSaveResponse(SAVE_RESPONSE)).toBe(TASK_ID);
  });

  it('日历页的同步响应没有 taskId', () => {
    // 同步端点，回读不必等待 —— 返回 null 让调用方走直通路径。
    const sync = JSON.stringify({ code: 200, message: '房量设置成功。', data: null });
    expect(taskIdOfSaveResponse(sync)).toBeNull();
  });

  it('非 JSON 或缺字段时返回 null', () => {
    expect(taskIdOfSaveResponse('<html>login</html>')).toBeNull();
    expect(taskIdOfSaveResponse('{"taskId":""}')).toBeNull();
  });
});

describe('taskStatusOfQueryResponse', () => {
  // ⚠️ 查询响应的 taskId 在**嵌套**的 mainTaskInfoForDisplayInfo 里，与写响应的顶层不同。
  it('从嵌套结构取 taskId 与 status', () => {
    expect(taskStatusOfQueryResponse(queryResponse('SUCCESS'))).toEqual({
      taskId: TASK_ID,
      status: 'SUCCESS',
    });
  });

  it('顶层有 taskId 但没有嵌套结构时返回 null', () => {
    // 写响应误喂进来时不该被当成查询结果。
    expect(taskStatusOfQueryResponse(SAVE_RESPONSE)).toBeNull();
  });
});

describe('CtripBatchTaskGate', () => {
  it('收到 SUCCESS 后放行', async () => {
    const gate = new CtripBatchTaskGate(createLogger(), 5_000);
    const pending = gate.waitFor(TASK_ID);

    gate.onTaskQueried(queryResponse('SUCCESS'));

    await expect(pending).resolves.toBe(true);
  });

  it('CREATING 不放行，继续等', async () => {
    const gate = new CtripBatchTaskGate(createLogger(), 50);
    const pending = gate.waitFor(TASK_ID);

    gate.onTaskQueried(queryResponse('CREATING'));

    // 只有 CREATING 的话一路等到超时。
    await expect(pending).resolves.toBe(false);
  });

  /**
   * ⚠️ 未知状态**不放行**。失败态没有样本，若按「不是 CREATING 就算完成」处理，会把一次
   * 失败的写入当成成功，回读到一份没真正生效的数据。
   */
  it('未知状态不放行', async () => {
    const gate = new CtripBatchTaskGate(createLogger(), 50);
    const pending = gate.waitFor(TASK_ID);

    gate.onTaskQueried(queryResponse('FAILED'));
    gate.onTaskQueried(queryResponse('WHATEVER'));

    await expect(pending).resolves.toBe(false);
  });

  it('超时后放弃并记 warn', async () => {
    const logger = createLogger();
    const gate = new CtripBatchTaskGate(logger, 30);

    await expect(gate.waitFor(TASK_ID)).resolves.toBe(false);
    expect(logger.warn).toHaveBeenCalled();
  });

  /**
   * ⭐ 竞态守护：SUCCESS 可能**先于** waitFor 到达。
   *
   * 回读侧要先走完既有上报链路（实测约 400ms）才调 waitFor，而页面轮询是并行的。
   * 没有「已完成」记录的话，先到的 SUCCESS 会因没人在等被丢弃，waitFor 随后一路等到超时
   * —— 表现为批量页永远回读不到，而日志上只有一条超时 warn，看不出是竞态。
   */
  it('SUCCESS 先于 waitFor 到达时仍然放行', async () => {
    const gate = new CtripBatchTaskGate(createLogger(), 50);

    gate.onTaskQueried(queryResponse('SUCCESS')); // 还没有人在等
    await expect(gate.waitFor(TASK_ID)).resolves.toBe(true);
  });

  it('已完成记录只能被消费一次', async () => {
    const gate = new CtripBatchTaskGate(createLogger(), 30);

    gate.onTaskQueried(queryResponse('SUCCESS'));
    await expect(gate.waitFor(TASK_ID)).resolves.toBe(true);
    // 第二次没有新的 SUCCESS，应当等到超时而不是直接放行。
    await expect(gate.waitFor(TASK_ID)).resolves.toBe(false);
  });

  it('其他任务的 SUCCESS 不会放行本任务', async () => {
    const gate = new CtripBatchTaskGate(createLogger(), 50);
    const pending = gate.waitFor(TASK_ID);

    gate.onTaskQueried(queryResponse('SUCCESS', 'another-task_202609'));

    await expect(pending).resolves.toBe(false);
  });

  it('dispose 让等待中的任务立即以未完成收场', async () => {
    const gate = new CtripBatchTaskGate(createLogger(), 60_000);
    const pending = gate.waitFor(TASK_ID);

    gate.dispose();

    // 不 dispose 的话这条要等 60 秒 —— 能立即 resolve 就证明定时器被清了。
    await expect(pending).resolves.toBe(false);
  });

  describe('rememberTask / takeTask', () => {
    it('登记后能按端点取出，且只能取一次', () => {
      const gate = new CtripBatchTaskGate(createLogger());

      gate.rememberTask('batchUpdateRoomStatusAndQuantity', SAVE_RESPONSE);

      expect(gate.takeTask('batchUpdateRoomStatusAndQuantity')).toBe(TASK_ID);
      expect(gate.takeTask('batchUpdateRoomStatusAndQuantity')).toBeNull();
    });

    it('同步端点的响应不产生登记', () => {
      const gate = new CtripBatchTaskGate(createLogger());
      const sync = JSON.stringify({ code: 200, message: '房量设置成功。', data: null });

      gate.rememberTask('setbatchroombookablestatus', sync);

      // 日历页没有 taskId —— 回读直接走，不等待。
      expect(gate.takeTask('setbatchroombookablestatus')).toBeNull();
    });
  });
});
