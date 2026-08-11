/**
 * `RmsAmountChangeGateway` 的 mock 实现 —— 只把上报体记进日志，不发 HTTP。
 *
 * 本期用 mock 是有意的：RMS 侧的接收端点还没定（谁反查绑定、怎么展开日期×房型、跟价策略
 * 放哪，都在 RMS 那边设计）。desktop 这一侧的拦截、配对、解析链路可以先独立跑通并真机验证，
 * 不必等远端。
 *
 * 换真实实现时照 `HttpRmsHotelGateway` 的形状写即可 —— `createRmsApiCall` + 已带认证的
 * fetch，本文件删掉，composition root 换一行装配。**接口不用改**。
 */
import type { AppLogger } from '../../../shared/logging';
import type { OtaAmountChangeReport } from '../../../shared/types/amount-change';
import type { RmsAmountChangeGateway } from './types';

export class MockRmsAmountChangeGateway implements RmsAmountChangeGateway {
  constructor(private readonly logger: AppLogger) {}

  reportAmountChange(report: OtaAmountChangeReport): Promise<void> {
    // 完整打出来（含 requestBody）——真机验证阶段就靠这条日志确认拦到的东西对不对。
    this.logger.info('[MOCK] Reporting amount change to RMS', {
      operationId: report.operationId,
      source: report.source,
      endpointId: report.endpointId,
      otaHotelId: report.otaHotelId,
      channelExtra: report.channelExtra,
      requestBody: report.requestBody,
      observedAt: report.observedAt,
    });
    return Promise.resolve();
  }
}
