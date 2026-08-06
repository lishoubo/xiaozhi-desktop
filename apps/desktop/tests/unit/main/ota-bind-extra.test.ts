import { describe, expect, it } from 'vitest';
import {
  douyinBindExtra,
  meituanBindExtra,
  merchantGroupIdFromBindExtra,
} from '../../../src/domain/ota-bind-extra';

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
