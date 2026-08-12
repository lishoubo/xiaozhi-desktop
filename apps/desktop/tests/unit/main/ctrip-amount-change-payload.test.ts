import { describe, expect, it } from 'vitest';
import { toCtripAmountChangeRaw } from '../../../src/main/channels/ctrip/amount-change-payload';

describe('携程 changeRaw 模型', () => {
  /**
   * 剔除的三个都是**框架噪音**：`reqHead` 含设备指纹、`cipher` 是凭证性质的签名串、
   * `head` 含 auth。与美团剔业务字段不同，这三个与「改了什么价」毫无关系。
   */
  it('剔除 reqHead / cipher / head 三个框架噪音字段', () => {
    const raw = toCtripAmountChangeRaw({
      roomPriceInfos: [{ roomProductId: '1587157522', salePrice: 720 }],
      dateRanges: [{ startDate: '2026-08-25', endDate: '2026-08-26' }],
      reqHead: { client: { screenWidth: 1512 }, ip: '10.0.0.1' },
      cipher: { '1587157522': 'AAEAAQ…-tripsign' },
      head: { cid: '090311622', auth: 'secret' },
    });

    expect(raw).not.toHaveProperty('reqHead');
    expect(raw).not.toHaveProperty('cipher');
    expect(raw).not.toHaveProperty('head');
  });

  it('业务字段一字不改地保留', () => {
    const body = {
      roomPriceInfoList: [
        { roomTypeID: 1587157432, hotelID: 115348672, salePrice: 720, refRoomIDs: [1582872853] },
      ],
      dateRangeInfo: [{ startDate: '2026-08-19', endDate: '2026-08-19' }],
      diffWeekendPrice: true,
      weekendDays: ['SATURDAY'],
    };

    expect(toCtripAmountChangeRaw({ ...body, reqHead: {} })).toEqual(body);
  });

  it('没有噪音字段时原样返回', () => {
    const body = { roomPriceInfos: [{ roomProductId: '1' }] };

    expect(toCtripAmountChangeRaw(body)).toEqual(body);
  });
});
