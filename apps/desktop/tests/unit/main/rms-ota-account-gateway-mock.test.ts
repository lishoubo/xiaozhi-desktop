import { describe, expect, it } from 'vitest';
import { MockRmsOtaAccountGateway } from '../../../src/main/gateway/rms/rms-ota-account-gateway-mock';

/** seed：1001 上海云栖酒店已绑 ctrip(30101) 与 douyin(30102，登录失效)。 */
const DOUYIN_EXPIRED_ID = 30102;

function reauthInput(
  overrides: Partial<Parameters<MockRmsOtaAccountGateway['reauthenticate']>[0]> = {},
) {
  return {
    operationId: 'op-1',
    otaAccountId: DOUYIN_EXPIRED_ID,
    cookies: [{ domain: 'life.douyin.com', name: 'sid', value: 'v' }],
    channelAccountId: 'account-1',
    ...overrides,
  };
}

describe('MockRmsOtaAccountGateway.reauthenticate', () => {
  it('把状态改回 BOUND', async () => {
    const gateway = new MockRmsOtaAccountGateway();

    const before = (await gateway.listOtaAccounts()).find((a) => a.id === DOUYIN_EXPIRED_ID);
    expect(before?.status).toBe('LOGIN_EXPIRED');

    const updated = await gateway.reauthenticate(reauthInput());

    expect(updated.status).toBe('BOUND');
  });

  /** 门店关系不属于这次操作——参数里根本没有它们。 */
  it('不改动门店关系', async () => {
    const gateway = new MockRmsOtaAccountGateway();
    const before = (await gateway.listOtaAccounts()).find((a) => a.id === DOUYIN_EXPIRED_ID);

    const updated = await gateway.reauthenticate(reauthInput());

    expect(updated.hotelId).toBe(before?.hotelId);
    expect(updated.otaHotelId).toBe(before?.otaHotelId);
    expect(updated.otaHotelName).toBe(before?.otaHotelName);
    expect(updated.source).toBe(before?.source);
  });

  it('补齐账号关联，且保留探测阶段的渠道字段', async () => {
    const gateway = new MockRmsOtaAccountGateway();

    const updated = await gateway.reauthenticate(reauthInput());

    expect(updated.bindExtra).toEqual({
      merchantGroupId: '7129084416', // seed 里原有的
      channelAccountId: 'account-1',
    });
  });

  it('账号标识为空时不写占位值', async () => {
    const gateway = new MockRmsOtaAccountGateway();

    const updated = await gateway.reauthenticate(reauthInput({ channelAccountId: null }));

    expect(updated.bindExtra).not.toHaveProperty('channelAccountId');
  });

  it('更新落在列表里，不是只返回一份副本', async () => {
    const gateway = new MockRmsOtaAccountGateway();

    await gateway.reauthenticate(reauthInput());

    const after = (await gateway.listOtaAccounts()).find((a) => a.id === DOUYIN_EXPIRED_ID);
    expect(after?.status).toBe('BOUND');
  });

  it('绑定不存在时明确失败', async () => {
    const gateway = new MockRmsOtaAccountGateway();

    await expect(gateway.reauthenticate(reauthInput({ otaAccountId: 99999 }))).rejects.toThrow(
      '绑定不存在或已被解除',
    );
  });
});
