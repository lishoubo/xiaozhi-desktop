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

  /**
   * 真机回归（2026-09-07，清水湾臻品酒店连锁账号）：`poiAccountList` 返回的是
   * 「能看到的账号列表」而非「门店列表」，第一条是集团账号自己 —— `poi_id` 为 '0'、
   * `account_type` 为 1，且真门店的 `parent_account_id` 正好指向它。
   *
   * 两条 `account_name` 完全相同，不排除的话界面上就是两个一模一样的选项、
   * 其中一个 ID 显示为 0，用户无从分辨（真机截图即为此现象）。
   */
  it('排除 poi_id 为 0 的集团账号记录，只留真门店', () => {
    const parsed = parseDouyinPoiAccountList({
      status_code: 0,
      data: {
        list: [
          {
            poi_id: '0',
            account_name: '清水湾臻品酒店(正翔店)',
            detail: {
              poi_id: '0',
              account_type: 1,
              parent_account_id: '0',
              life_account_id: '7644113868221958186',
            },
          },
          {
            poi_id: '7644484291417606150',
            account_name: '清水湾臻品酒店(正翔店)',
            detail: {
              poi_id: '7644484291417606150',
              account_type: 20,
              parent_account_id: '7644113868221958186',
              life_account_id: '7644483750218172462',
            },
          },
        ],
        pagination: { total_count: 2, page_count: 1 },
      },
    });

    expect(parsed?.hotels).toEqual([
      { otaHotelId: '7644484291417606150', otaHotelName: '清水湾臻品酒店(正翔店)' },
    ]);
  });

  it('detail.poi_id 为 0 时同样排除（顶层缺失退到 detail 的情况）', () => {
    const parsed = parseDouyinPoiAccountList({
      status_code: 0,
      data: { list: [{ account_name: '集团', detail: { poi_id: '0' } }, { poi_id: '222' }] },
    });

    expect(parsed?.hotels).toEqual([{ otaHotelId: '222', otaHotelName: null }]);
  });

  it('整份列表只有集团账号时返回 null，让调用方去等另一个端点', () => {
    const parsed = parseDouyinPoiAccountList({
      status_code: 0,
      data: { list: [{ poi_id: '0', account_name: '集团' }] },
    });

    expect(parsed).toBeNull();
  });

  /** poi_id 是 19 位十进制串，超出 Number 安全范围；不能靠转数值判 0。 */
  it('19 位长 ID 不受影响，不做数值转换', () => {
    const parsed = parseDouyinPoiAccountList({
      status_code: 0,
      data: { list: [{ poi_id: '7644484291417606150', account_name: 'A' }] },
    });

    expect(parsed?.hotels[0]?.otaHotelId).toBe('7644484291417606150');
  });
});
