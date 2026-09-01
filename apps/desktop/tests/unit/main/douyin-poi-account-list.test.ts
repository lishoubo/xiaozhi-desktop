import { describe, expect, it } from 'vitest';
import { parseDouyinPoiAccountList } from '../../../src/main/channels/douyin/poi-account-list';

/** 取自 docs/踩点/抖音/多酒店踩点.md 的真实响应，只保留解析用得到的字段。 */
function realResponse() {
  return {
    data: {
      list: [
        {
          account_id: '1866305022956810',
          account_name: '美豪丽致酒店(沈阳站太原街店)',
          detail: {
            life_account_name: '美豪丽致酒店(沈阳站太原街店)',
            poi_id: '7487832483166160959',
            root_life_account_id: '7129809840498706464',
          },
          poi_id: '7487832483166160959',
          status: 1,
        },
      ],
      pagination: { page_count: 1, page_index: 1, page_size: 10, total_count: 1 },
    },
    status_code: 0,
    status_msg: '',
  };
}

describe('parseDouyinPoiAccountList', () => {
  it('解析真实响应，取出门店 ID 与名称', () => {
    const parsed = parseDouyinPoiAccountList(realResponse());

    expect(parsed).toEqual({
      hotels: [{ otaHotelId: '7487832483166160959', otaHotelName: '美豪丽致酒店(沈阳站太原街店)' }],
      totalCount: 1,
      pageCount: 1,
    });
  });

  it('连锁账号返回多家门店时全部取出', () => {
    const parsed = parseDouyinPoiAccountList({
      status_code: 0,
      data: {
        list: [
          { poi_id: '111', account_name: 'A 店' },
          { poi_id: '222', account_name: 'B 店' },
          { poi_id: 333, account_name: 'C 店' },
        ],
        pagination: { total_count: 3, page_count: 1 },
      },
    });

    expect(parsed?.hotels).toEqual([
      { otaHotelId: '111', otaHotelName: 'A 店' },
      { otaHotelId: '222', otaHotelName: 'B 店' },
      { otaHotelId: '333', otaHotelName: 'C 店' },
    ]);
  });

  it('业务码非 0 时返回 null，交由另一个端点出数据', () => {
    expect(
      parseDouyinPoiAccountList({
        status_code: 40001,
        status_msg: 'no permission',
        data: { list: [{ poi_id: '111', account_name: 'A 店' }] },
      }),
    ).toBeNull();
  });

  it('列表为空时返回 null —— 单店账号调这个接口就是这种结果', () => {
    expect(
      parseDouyinPoiAccountList({ status_code: 0, data: { list: [], pagination: {} } }),
    ).toBeNull();
  });

  it('形状完全不对时返回 null，不抛错', () => {
    expect(parseDouyinPoiAccountList(null)).toBeNull();
    expect(parseDouyinPoiAccountList('not json')).toBeNull();
    expect(parseDouyinPoiAccountList({ data: { list: 'nope' } })).toBeNull();
  });

  it('缺 poi_id 的记录被跳过，其余照常取出', () => {
    const parsed = parseDouyinPoiAccountList({
      status_code: 0,
      data: { list: [{ account_name: '没有 ID 的店' }, { poi_id: '222', account_name: 'B 店' }] },
    });

    expect(parsed?.hotels).toEqual([{ otaHotelId: '222', otaHotelName: 'B 店' }]);
  });

  it('顶层没有 account_name 时退到 detail.life_account_name', () => {
    const parsed = parseDouyinPoiAccountList({
      status_code: 0,
      data: { list: [{ poi_id: '111', detail: { life_account_name: '兜底名' } }] },
    });

    expect(parsed?.hotels).toEqual([{ otaHotelId: '111', otaHotelName: '兜底名' }]);
  });

  it('两个名字都没有时门店名为 null，但门店本身仍然可选', () => {
    const parsed = parseDouyinPoiAccountList({
      status_code: 0,
      data: { list: [{ poi_id: '111', account_name: '   ' }] },
    });

    expect(parsed?.hotels).toEqual([{ otaHotelId: '111', otaHotelName: null }]);
  });
});
