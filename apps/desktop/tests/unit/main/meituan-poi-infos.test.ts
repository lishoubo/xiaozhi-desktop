import { describe, expect, it } from 'vitest';
import { toOtaHotelId } from '../../../src/domain/identity';
import { parseMeituanPoiInfos } from '../../../src/main/ota/meituan/poi-infos';

describe('parseMeituanPoiInfos', () => {
  it('映射所有有效酒店及合作方上下文', () => {
    expect(
      parseMeituanPoiInfos({
        code: '10000',
        data: {
          twoLevelList: [
            {
              poiList: [
                {
                  poiId: 101,
                  poiName: '酒店一',
                  partnerId: 201,
                  partnerName: '合作方一',
                },
                {
                  poiId: '102',
                  poiName: '酒店二',
                },
              ],
            },
          ],
        },
      }),
    ).toEqual([
      {
        otaHotelId: toOtaHotelId('101'),
        otaHotelName: '酒店一',
        bindExtra: { otaPartnerId: '201', otaPartnerName: '合作方一' },
      },
      {
        otaHotelId: toOtaHotelId('102'),
        otaHotelName: '酒店二',
        bindExtra: null,
      },
    ]);
  });

  it('忽略无 ID 或无名称的条目', () => {
    expect(
      parseMeituanPoiInfos({
        code: 10000,
        data: {
          twoLevelList: [{ poiList: [{ poiId: '', poiName: '无 ID' }, { poiId: '1' }] }],
        },
      }),
    ).toEqual([]);
  });

  it('无效响应或失败响应返回 null', () => {
    expect(parseMeituanPoiInfos({ code: 500, data: {} })).toBeNull();
    expect(parseMeituanPoiInfos({ code: 10000, data: 'invalid' })).toBeNull();
  });
});
