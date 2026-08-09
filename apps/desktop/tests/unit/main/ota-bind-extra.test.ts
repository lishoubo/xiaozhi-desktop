import { describe, expect, it } from 'vitest';
import {
  douyinBindExtra,
  meituanBindExtra,
  merchantGroupIdFromBindExtra,
  withChannelAccount,
} from '../../../src/main/channels/bind-extra';

describe('OTA bindExtra', () => {
  it('抖音保存并读取 merchantGroupId', () => {
    const extra = douyinBindExtra('group-1');
    expect(extra).toEqual({ merchantGroupId: 'group-1' });
    expect(merchantGroupIdFromBindExtra(extra)).toBe('group-1');
  });

  it('美团保存结构化 partner 信息', () => {
    expect(meituanBindExtra('partner-1', '服务商')).toEqual({
      otaPartnerId: 'partner-1',
      otaPartnerName: '服务商',
    });
    expect(meituanBindExtra(null, null)).toBeNull();
  });

  it('无效抖音 bindExtra 不返回 groupId', () => {
    expect(merchantGroupIdFromBindExtra({ merchantGroupId: 123 })).toBeNull();
    expect(merchantGroupIdFromBindExtra(null)).toBeNull();
  });
});

describe('withChannelAccount', () => {
  /** 账号名的键随渠道不同，取不到名字也不该丢掉 ID。 */
  it.each([
    ['携程', { hotelId: 'ct-1', hotelName: '平江府' }, '平江府'],
    ['抖音', { loginId: '188', name: '云朵酒店', roleType: 2 }, '云朵酒店'],
    ['美团', { partnerId: 'p-1', login: 'yunduo01' }, 'yunduo01'],
    ['无可用名字', { roleType: 2 }, undefined],
  ])('%s：写入账号 ID 与名称', (_channel, credentialExtra, expectedName) => {
    expect(withChannelAccount(null, { channelAccountId: 'acc-1', credentialExtra })).toEqual({
      channelAccountId: 'acc-1',
      ...(expectedName === undefined ? {} : { channelAccountName: expectedName }),
    });
  });

  it('保留渠道自己的绑定上下文', () => {
    expect(
      withChannelAccount(douyinBindExtra('group-1'), {
        channelAccountId: 'acc-1',
        credentialExtra: { name: '云朵酒店' },
      }),
    ).toEqual({
      merchantGroupId: 'group-1',
      channelAccountId: 'acc-1',
      channelAccountName: '云朵酒店',
    });
  });

  /** 空值省略字段而非写 null——否则读取时分不清「没有」和「是空的」。 */
  it('两者都取不到时原样返回', () => {
    expect(withChannelAccount(null, { channelAccountId: null, credentialExtra: null })).toBeNull();
    expect(
      withChannelAccount(
        { merchantGroupId: 'group-1' },
        {
          channelAccountId: '',
          credentialExtra: { name: '   ' },
        },
      ),
    ).toEqual({ merchantGroupId: 'group-1' });
  });
});
