import { describe, expect, it, vi } from 'vitest';
import { toChannelId, toOtaCredentialId } from '../../../src/main/ids';
import { HotelManagementService } from '../../../src/main/services/hotel-management-service';
import type { OtaCredential } from '../../../src/shared/types/ota-credential';

function credential(overrides: Partial<OtaCredential> = {}): OtaCredential {
  return {
    id: toOtaCredentialId('credential-1'),
    channel: toChannelId('douyin'),
    channelAccountId: 'account-1',
    partitionName: 'persist:xiaozhi:prod:douyin:aaa',
    credentialExtra: null,
    discoveredAt: 1,
    lastRefreshedAt: null,
    ...overrides,
  };
}

const HOTEL = {
  otaHotelId: 'dy-111',
  otaHotelName: '测试酒店',
  bindExtra: { merchantGroupId: 'group-1' },
} as const;

function setup(
  overrides: {
    bind?: ReturnType<typeof vi.fn>;
    save?: ReturnType<typeof vi.fn>;
    reauthenticate?: ReturnType<typeof vi.fn>;
    findById?: ReturnType<typeof vi.fn>;
    findByChannelAndHotelId?: ReturnType<typeof vi.fn>;
    findByChannelAndAccountId?: ReturnType<typeof vi.fn>;
  } = {},
) {
  let idCounter = 0;
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const otaHotelRepository = {
    save: overrides.save ?? vi.fn((input) => input),
    findByChannelAndHotelId: overrides.findByChannelAndHotelId ?? vi.fn(() => null),
  };
  const otaAccountGateway = {
    listOtaAccounts: vi.fn(),
    bind: overrides.bind ?? vi.fn().mockResolvedValue({ id: 7 }),
    unbind: vi.fn(),
    reauthenticate: overrides.reauthenticate ?? vi.fn().mockResolvedValue({ id: 7 }),
  };
  const service = new HotelManagementService({
    hotelGateway: { listHotels: vi.fn(), createHotel: vi.fn(), deleteHotel: vi.fn() },
    otaAccountGateway,
    otaHotelRepository,
    otaCredentialRepository: {
      findById: overrides.findById ?? vi.fn(() => credential()),
      findByChannelAndAccountId: overrides.findByChannelAndAccountId ?? vi.fn(() => null),
    },
    readCookieSnapshot: vi.fn().mockResolvedValue([{ domain: 'a.com', name: 'k', value: 'v' }]),
    generateRequestId: () => `id-${++idCounter}`,
    logger,
  });
  return { service, otaHotelRepository, otaAccountGateway, logger };
}

describe('HotelManagementService 绑定流程', () => {
  it('startBinding 只发号——标签页由渲染进程自己开', () => {
    const { service } = setup();

    expect(service.startBinding().requestId).toBe('id-1');
    // 每次发起都是新号，两个并发绑定各自认领各自的候选。
    expect(service.startBinding().requestId).toBe('id-2');
  });

  it('confirmBinding 先写远端、成功后才写本地', async () => {
    const { service, otaHotelRepository, otaAccountGateway } = setup();

    await service.confirmBinding({ credentialId: 'credential-1', rmsHotelId: 42, hotel: HOTEL });

    expect(otaAccountGateway.bind).toHaveBeenCalledWith(
      expect.objectContaining({
        hotelId: 42,
        source: 'douyin',
        otaHotelId: 'dy-111',
        otaHotelName: '测试酒店',
        // 探测阶段的渠道字段 + 本次使用的账号标识，两者并存
        bindExtra: { merchantGroupId: 'group-1', channelAccountId: 'account-1' },
        cookies: [{ domain: 'a.com', name: 'k', value: 'v' }],
      }),
    );
    expect(otaHotelRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        credentialId: 'credential-1',
        channel: 'douyin',
        otaHotelId: 'dy-111',
        otaHotelName: '测试酒店',
        bindExtra: { merchantGroupId: 'group-1' },
      }),
    );
  });

  it('远端绑定失败时不写本地', async () => {
    const { service, otaHotelRepository } = setup({
      bind: vi.fn().mockRejectedValue(new Error('远端炸了')),
    });

    await expect(
      service.confirmBinding({ credentialId: 'credential-1', rmsHotelId: 42, hotel: HOTEL }),
    ).rejects.toThrow('远端炸了');

    expect(otaHotelRepository.save).not.toHaveBeenCalled();
  });

  /**
   * 远端已经绑定成功，本地只是缓存。若把本地失败报成绑定失败，用户一重试远端就会以
   * 「已存在活跃绑定」拒绝——人被卡死在一个其实早已成功的操作上。
   */
  it('本地写入失败不算绑定失败：仍返回远端结果，只记警告', async () => {
    const { service, logger } = setup({
      save: vi.fn(() => {
        throw new Error('磁盘炸了');
      }),
    });

    await expect(
      service.confirmBinding({ credentialId: 'credential-1', rmsHotelId: 42, hotel: HOTEL }),
    ).resolves.toEqual({ id: 7 });

    expect(logger.warn).toHaveBeenCalledWith(
      'OTA hotel saved remotely but not locally',
      expect.objectContaining({ channel: 'douyin' }),
    );
  });

  /** 空值不写占位：写了 null，下次读取分不清「没有这个字段」和「字段是空的」。 */
  it('凭证没有渠道账号标识时，bindExtra 不含该字段', async () => {
    const { service, otaAccountGateway } = setup({
      findById: vi.fn(() => credential({ channelAccountId: null })),
    });

    await service.confirmBinding({ credentialId: 'credential-1', rmsHotelId: 42, hotel: HOTEL });

    const passed = otaAccountGateway.bind.mock.calls[0]?.[0] as { bindExtra: object };
    expect(passed.bindExtra).toEqual({ merchantGroupId: 'group-1' });
    expect(passed.bindExtra).not.toHaveProperty('channelAccountId');
  });

  it('凭据不存在时明确失败，不调远端也不写本地', async () => {
    const otaHotelRepository = { save: vi.fn(), findByChannelAndHotelId: vi.fn(() => null) };
    const otaAccountGateway = {
      listOtaAccounts: vi.fn(),
      bind: vi.fn(),
      unbind: vi.fn(),
      reauthenticate: vi.fn(),
    };
    const service = new HotelManagementService({
      hotelGateway: { listHotels: vi.fn(), createHotel: vi.fn(), deleteHotel: vi.fn() },
      otaAccountGateway,
      otaHotelRepository,
      otaCredentialRepository: {
        findById: vi.fn(() => null),
        findByChannelAndAccountId: vi.fn(() => null),
      },
      readCookieSnapshot: vi.fn(),
      generateRequestId: () => 'id',
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    await expect(
      service.confirmBinding({
        credentialId: 'missing',
        rmsHotelId: 42,
        hotel: HOTEL,
      }),
    ).rejects.toThrow('未找到该登录凭据');

    expect(otaAccountGateway.bind).not.toHaveBeenCalled();
    expect(otaHotelRepository.save).not.toHaveBeenCalled();
  });
});

describe('HotelManagementService 重新登录', () => {
  it('startReauth 只发号', () => {
    const { service } = setup();

    expect(service.startReauth().requestId).toBe('id-1');
    expect(service.startReauth().requestId).toBe('id-2');
  });

  it('confirmReauth 用该凭证的实时 cookie 调 reauthenticate，并带上账号标识', async () => {
    const { service, otaAccountGateway } = setup();

    await expect(
      service.confirmReauth({ otaAccountId: 30102, credentialId: 'credential-1' }),
    ).resolves.toEqual({ id: 7 });

    expect(otaAccountGateway.reauthenticate).toHaveBeenCalledWith(
      expect.objectContaining({
        otaAccountId: 30102,
        cookies: [{ domain: 'a.com', name: 'k', value: 'v' }],
        channelAccountId: 'account-1',
      }),
    );
  });

  /** 门店关系不属于这次操作——参数里根本没有它，类型上就改不了。 */
  it('confirmReauth 不写本地 ota_hotel', async () => {
    const { service, otaHotelRepository } = setup();

    await service.confirmReauth({ otaAccountId: 30102, credentialId: 'credential-1' });

    expect(otaHotelRepository.save).not.toHaveBeenCalled();
  });

  it('凭据不存在时明确失败，不调远端', async () => {
    const { service, otaAccountGateway } = setup({ findById: vi.fn(() => null) });

    await expect(
      service.confirmReauth({ otaAccountId: 30102, credentialId: 'missing' }),
    ).rejects.toThrow('未找到该登录凭据');

    expect(otaAccountGateway.reauthenticate).not.toHaveBeenCalled();
  });
});

describe('HotelManagementService.findCredentialForAccount', () => {
  const ACCOUNT = { source: 'douyin', otaHotelId: 'dy-111', bindExtra: null } as const;

  /** 新数据：绑定那一刻写下的关联，不必绕本地表。 */
  it('bindExtra 带 channelAccountId 时直接匹配凭证', () => {
    const findByChannelAndAccountId = vi.fn(() =>
      credential({ id: toOtaCredentialId('cred-new') }),
    );
    const findByChannelAndHotelId = vi.fn(() => null);
    const { service } = setup({ findByChannelAndAccountId, findByChannelAndHotelId });

    const result = service.findCredentialForAccount({
      ...ACCOUNT,
      bindExtra: { channelAccountId: 'account-1' },
    });

    expect(result).toBe('cred-new');
    // 新数据命中就不该再去查本地酒店表
    expect(findByChannelAndHotelId).not.toHaveBeenCalled();
  });

  /** 老数据：只有 source + otaHotelId，绕本地 ota_hotel 反查。 */
  it('没有 channelAccountId 时按 (渠道, OTA 酒店 ID) 反查', () => {
    const { service } = setup({
      findByChannelAndHotelId: vi.fn(() => ({ credentialId: 'cred-old' })),
    });

    expect(service.findCredentialForAccount(ACCOUNT)).toBe('cred-old');
  });

  it('新数据没命中时退回老数据路径', () => {
    const { service } = setup({
      findByChannelAndAccountId: vi.fn(() => null),
      findByChannelAndHotelId: vi.fn(() => ({ credentialId: 'cred-old' })),
    });

    const result = service.findCredentialForAccount({
      ...ACCOUNT,
      bindExtra: { channelAccountId: '已被清理的账号' },
    });

    expect(result).toBe('cred-old');
  });

  /** 找不到不是错误——凭证可能已清理，或绑定发生在别的设备上。 */
  it('两条路都没命中时返回 null，不抛错', () => {
    const { service } = setup();

    expect(service.findCredentialForAccount(ACCOUNT)).toBeNull();
  });

  it('otaHotelId 为 null 时不查本地表', () => {
    const findByChannelAndHotelId = vi.fn(() => null);
    const { service } = setup({ findByChannelAndHotelId });

    expect(service.findCredentialForAccount({ ...ACCOUNT, otaHotelId: null })).toBeNull();
    expect(findByChannelAndHotelId).not.toHaveBeenCalled();
  });

  /** 远端的 otaHotelId 不满足本地 id 约束时不能让整个弹窗炸掉。 */
  it('otaHotelId 不合法时返回 null 而不是抛错', () => {
    const { service } = setup();

    expect(
      service.findCredentialForAccount({ ...ACCOUNT, otaHotelId: 'x'.repeat(200) }),
    ).toBeNull();
  });
});
